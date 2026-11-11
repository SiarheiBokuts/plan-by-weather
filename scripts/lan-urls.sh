#!/bin/sh
# Prints the addresses of the running service, also the one other devices on the same Wi-Fi can open
# (for example another computer). Used by `npm run lan` and `npm run up`.
port="${APP_PORT:-4747}"
ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "Open on this computer:"
echo "  Web page (test UI)     http://localhost:$port/ui/"
echo "  Apollo Sandbox         http://localhost:$port/graphql"
echo "  Health                 http://localhost:$port/health"
if [ -n "$ip" ]; then
  echo ""
  echo "Open from another device on the same Wi-Fi:"
  echo "  Web page (test UI)     http://$ip:$port/ui/"
  echo "  Apollo Sandbox         http://$ip:$port/graphql"
  echo "  Health                 http://$ip:$port/health"
fi
echo ""
