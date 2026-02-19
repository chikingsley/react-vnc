FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV DISPLAY=:1

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    fluxbox \
    x11vnc \
    websockify \
    netcat-openbsd \
    fonts-dejavu-core \
    ca-certificates \
    xterm \
    x11-apps \
    && rm -rf /var/lib/apt/lists/*

COPY tests/vnc-server/start-vnc.sh /usr/local/bin/start-vnc.sh
RUN chmod +x /usr/local/bin/start-vnc.sh

EXPOSE 5900 6080

CMD ["/usr/local/bin/start-vnc.sh"]
