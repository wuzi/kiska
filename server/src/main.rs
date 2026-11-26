use patchboard::{AppState, app, contract, publishing};
use sqlx::postgres::PgPoolOptions;
use std::{net::SocketAddr, time::Duration};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "serve".into());
    if command == "openapi" {
        println!("{}", contract::spec());
        return Ok(());
    }
    let db = PgPoolOptions::new()
        .max_connections(24)
        .acquire_timeout(Duration::from_secs(3))
        .connect(&std::env::var("DATABASE_URL")?)
        .await?;
    match command.as_str() {
        "migrate" => sqlx::migrate!("./migrations").run(&db).await?,
        "operator" => {
            let email = args
                .next()
                .ok_or_else(|| anyhow::anyhow!("usage: patchboard operator VERIFIED_EMAIL"))?;
            let n=sqlx::query("UPDATE accounts SET operator=true WHERE email=lower($1) AND verified AND closed_at IS NULL").bind(email).execute(&db).await?;
            anyhow::ensure!(n.rows_affected() == 1, "verified account not found");
        }
        "serve" => {
            let origin =
                std::env::var("PUBLIC_ORIGIN").unwrap_or_else(|_| "http://localhost:8080".into());
            let addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
            let listener = tokio::net::TcpListener::bind(addr).await?;
            axum::serve(
                listener,
                app(AppState {
                    db,
                    origin: origin.trim_end_matches('/').into(),
                })
                .into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await?;
        }
        "worker" => {
            let mut maintenance = tokio::time::interval(Duration::from_secs(60));
            loop {
                tokio::select! {
                    _ = maintenance.tick() => {
                        if let Err(error) = publishing::maintenance(&db).await {
                            tracing::error!(%error, "maintenance failed");
                        }
                    }
                    result = publishing::work_once(&db) => {
                        if !matches!(result, Ok(true)) {
                            if let Err(error) = result {tracing::error!(%error, "mail worker failed");}
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                    }
                }
            }
        }
        _ => anyhow::bail!("unknown command {command}"),
    }
    Ok(())
}
