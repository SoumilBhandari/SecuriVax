#!/bin/sh
# A self-signed HTTPS certificate for testing on a phone over Wi-Fi: phones
# only allow the live camera on HTTPS pages. Made locally with openssl, for
# this laptop's current Wi-Fi address; remade when that address changes.
set -e
cd "$(dirname "$0")/.."
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
mkdir -p .cert
if [ -f .cert/dev.crt ] && openssl x509 -in .cert/dev.crt -noout -text | grep -q "IP Address:$IP"; then
  :
else
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -keyout .cert/dev.key -out .cert/dev.crt \
    -subj "/CN=SecuriVax dev" -addext "subjectAltName=IP:$IP,IP:127.0.0.1,DNS:localhost" 2>/dev/null
fi
echo ""
echo "  On your phone (same Wi-Fi):  https://$IP:5173"
echo "  Accept the certificate warning once (it's this laptop's own certificate)."
echo ""
