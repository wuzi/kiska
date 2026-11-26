# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS web
WORKDIR /build/web
COPY web/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM rust:1.97.1-bookworm@sha256:0e2bcaef56d041a486784e54104a81aebe0da44bd03019bd70bc0401e42e4a97 AS rust
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY server/Cargo.toml server/Cargo.toml
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/target \
    mkdir -p server/src && echo 'fn main() {}' > server/src/main.rs && cargo build --locked --release -p kiska && rm -rf server/src
COPY server/ server/
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/build/target \
    touch server/src/main.rs && cargo build --locked --release -p kiska && cp target/release/kiska /kiska

FROM debian:bookworm-slim@sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=rust /kiska /usr/local/bin/kiska
COPY --from=web /build/web/dist /opt/kiska/web
ENV WEB_DIST=/opt/kiska/web
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["kiska"]
CMD ["serve"]
