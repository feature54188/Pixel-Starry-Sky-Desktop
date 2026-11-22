#!/bin/bash
# 在 GitHub 的 macOS 发版机上导入项目的固定代码签名身份。
set -euo pipefail
umask 077
: "${MACOS_SIGNING_PRIVATE_KEY:?缺少 MACOS_SIGNING_PRIVATE_KEY}"
sign_dir="$(mktemp -d "$RUNNER_TEMP/pixelsky-signing.XXXXXX")"
cert="$(dirname "$0")/../apps/desktop/build/macos-signing.pem"
p12="$sign_dir/release.p12"
keychain="$sign_dir/release.keychain-db"
password="$(openssl rand -hex 32)"
echo "::add-mask::$password"
# security import 兼容的 PKCS#12 格式。私钥经标准输入传给 openssl。
export PIXELSKY_P12_PASSWORD="$password"
printf '%s\n' "$MACOS_SIGNING_PRIVATE_KEY" | openssl pkcs12 -export -inkey /dev/stdin \
  -in "$cert" -out "$p12" -passout env:PIXELSKY_P12_PASSWORD \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
# 自签证书的信任仅在一次性的发版运行机上生效，仅用于代码签名。
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$cert"
identity="$(openssl x509 -in "$cert" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d ':')"
security create-keychain -p "$password" "$keychain"
security unlock-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security import "$p12" -k "$keychain" -P "$password" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$keychain" >/dev/null
keychains=()
while IFS= read -r path; do
  keychains+=("$path")
done < <(security list-keychains -d user | sed -E 's/^[[:space:]]*"([^"]+)"$/\1/')
security list-keychains -d user -s "$keychain" "${keychains[@]}"
security find-identity -v -p codesigning "$keychain" | grep -F "$identity"
echo "PIXELSKY_MAC_IDENTITY=$identity" >> "$GITHUB_ENV"
