# syntax=docker/dockerfile:1.7
# Sauvegarde chiffrée de la base : pg_dump -> age (clé publique seulement) -> copie locale + envoi S3 (rclone).
FROM alpine:3.22
RUN apk add --no-cache postgresql16-client age rclone tzdata ca-certificates \
    && addgroup -S -g 10001 app && adduser -S -u 10001 -G app app \
    && mkdir -p /backups && chown app:app /backups
COPY --chmod=0755 backup.sh restore.sh scheduler.sh /usr/local/bin/
USER app
VOLUME ["/backups"]
HEALTHCHECK --interval=1h --timeout=5s --start-period=1m --retries=1 \
    CMD ["sh", "-c", "test -n \"$(find /backups -name 'last-success.txt' -mtime -2 2>/dev/null)\" || test ! -e /backups/last-success.txt"]
CMD ["scheduler.sh"]
