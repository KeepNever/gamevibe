#!/usr/bin/env bash
# GameVibe 后端端到端联调脚本
BASE=http://localhost:8787

echo "== health =="
curl -s $BASE/api/health; echo

echo "== register =="
curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"tester","email":"t@example.com","password":"secret123"}'; echo

echo "== login =="
LOGIN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"t@example.com","password":"secret123"}')
echo "$LOGIN"
TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | sed 's/"token":"//;s/"//')
echo "TOKEN=${TOKEN:0:20}..."

echo "== me =="
curl -s $BASE/api/auth/me -H "Authorization: Bearer $TOKEN"; echo

echo "== library/scan =="
curl -s $BASE/api/library/scan -H "Authorization: Bearer $TOKEN"; echo

echo "== library/import =="
curl -s -X POST $BASE/api/library/import -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"external_id":"999","name":"Test Game","cover_url":"http://x/y.jpg","install_path":"C:/x","size_bytes":123,"last_played":null}]}'; echo

echo "== library list =="
curl -s $BASE/api/library -H "Authorization: Bearer $TOKEN"; echo

echo "== collections/wishlist POST =="
curl -s -X POST $BASE/api/collections/wishlist -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"gameId":"elden-ring","name":"艾尔登法环","coverUrl":"/covers/elden-ring.png"}'; echo

echo "== collections/wishlist GET =="
curl -s $BASE/api/collections/wishlist -H "Authorization: Bearer $TOKEN"; echo

echo "== collections/recent POST + GET =="
curl -s -X POST $BASE/api/collections/recent -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"gameId":"cs2"}'; echo
curl -s $BASE/api/collections/recent -H "Authorization: Bearer $TOKEN"; echo

echo "== ai/chat (stream, truncated) =="
curl -s -N -X POST $BASE/api/ai/chat -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"推荐几个高难度魂类游戏"}' | head -c 800; echo

echo "== ai/history =="
curl -s $BASE/api/ai/history -H "Authorization: Bearer $TOKEN"; echo

echo "== igdb skeleton =="
curl -s $BASE/api/igdb/games; echo
