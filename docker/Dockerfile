# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS application
WORKDIR /build
COPY cloudsave-windows/package.json cloudsave-windows/package-lock.json ./
RUN npm ci --no-audit --no-fund && node node_modules/electron/install.js
COPY cloudsave-windows/ ./
# Keep only the explicitly declared application files and the Linux runtime.
RUN node -e "const fs=require('fs');fs.mkdirSync('/out');for(const f of require('./package.json').build.files)fs.copyFileSync(f,'/out/'+f)" \
    && cp -a node_modules/electron/dist /out/electron

FROM jlesage/baseimage-gui:debian-12-v4.14.0
RUN add-pkg libnss3 libatk1.0-0 libatk-bridge2.0-0 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libgtk-3-0 \
    libxshmfence1 libxss1 libsecret-1-0 fonts-noto-cjk ca-certificates curl \
    && mkdir -p /opt/cloudsave /output
COPY --from=application /out/ /opt/cloudsave/
COPY docker/startapp.sh /startapp.sh
COPY docker/55-cloudsave.sh /etc/cont-init.d/55-cloudsave.sh
COPY docker/container-entry.cjs /opt/cloudsave/container-entry.cjs
COPY docker/smoke.cjs /opt/cloudsave/smoke.cjs
RUN chmod 755 /startapp.sh /etc/cont-init.d/55-cloudsave.sh /opt/cloudsave/electron/electron \
    && chown root:root /opt/cloudsave/electron/chrome-sandbox \
    && chmod 4755 /opt/cloudsave/electron/chrome-sandbox \
    && set-cont-env APP_NAME 'CloudSave 云存助手' \
    && set-cont-env SERVICES_GRACETIME 60000
ENV CLOUDSAVE_STORAGE_ROOT=/config \
    SECURE_CONNECTION=1 WEB_AUTHENTICATION=1 \
    WEB_AUTHENTICATION_USERNAME=admin \
    WEB_FILE_MANAGER=1 WEB_FILE_MANAGER_ALLOWED_PATHS=/output \
    WEB_TERMINAL=0 VNC_LISTENING_PORT=-1 \
    DISPLAY_WIDTH=1600 DISPLAY_HEIGHT=1000 TZ=Asia/Shanghai
LABEL org.opencontainers.image.title="云存助手 Docker x86-64" \
      org.opencontainers.image.source="https://github.com/bwdd-ui/cloudsave-assistant"
VOLUME ["/config", "/output"]
EXPOSE 5800
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD curl --fail --insecure --silent https://127.0.0.1:5800/ >/dev/null && pgrep -f '/opt/cloudsave/electron/electron' >/dev/null || exit 1
