FROM postgres:15.19-bookworm@sha256:19b8449e2187e8a174b40c8832a7ed9da45813b74c2779b1c614e7e7d0ee47f0
RUN apt-get update && apt-get install -y --no-install-recommends awscli ca-certificates && rm -rf /var/lib/apt/lists/*
COPY backup/capture.sh restore/import.sh /usr/local/bin/
ENTRYPOINT []
