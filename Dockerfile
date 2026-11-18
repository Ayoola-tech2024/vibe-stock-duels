FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download
COPY server/ ./server/
RUN cd server && CGO_ENABLED=0 go build -o /vibe-server .

FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /vibe-server /app/vibe-server
COPY index.html index.2d.html app.js styles.css manifest.webmanifest sw.js ./
COPY assets/ ./assets/
RUN mkdir -p /data
ENV PORT=8080
EXPOSE 8080
CMD ["/app/vibe-server", "-addr", ":8080", "-static", "/app", "-db", "/data/vibe.db"]
