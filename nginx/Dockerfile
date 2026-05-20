FROM alpine:3.19 AS builder

RUN apk add --no-cache \
    build-base \
    pcre-dev \
    zlib-dev \
    openssl-dev \
    git \
    curl

WORKDIR /build

RUN curl -fsSL https://nginx.org/download/nginx-1.24.0.tar.gz | tar xz && \
    git clone --depth 1 --branch v1.2.2 https://github.com/arut/nginx-rtmp-module.git && \
    cd nginx-1.24.0 && \
    ./configure \
        --prefix=/etc/nginx \
        --sbin-path=/usr/sbin/nginx \
        --conf-path=/etc/nginx/nginx.conf \
        --error-log-path=/var/log/nginx/error.log \
        --http-log-path=/var/log/nginx/access.log \
        --pid-path=/var/run/nginx.pid \
        --with-http_ssl_module \
        --add-module=../nginx-rtmp-module && \
    make -j$(nproc) && \
    make install

FROM alpine:3.19

RUN apk add --no-cache pcre zlib openssl gettext

COPY --from=builder /etc/nginx /etc/nginx
COPY --from=builder /usr/sbin/nginx /usr/sbin/nginx

RUN mkdir -p /var/log/nginx /var/run /etc/nginx/conf.d

COPY nginx.conf /etc/nginx/nginx.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN echo "" > /etc/nginx/rtmp-push.conf

EXPOSE 1935

ENTRYPOINT ["/entrypoint.sh"]
