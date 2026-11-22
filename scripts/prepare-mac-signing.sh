#!/bin/bash
# 在 GitHub 的 macOS 发版机上导入项目的固定代码签名身份。
set -euo pipefail
umask 077
: "${MACOS_SIGNING_PRIVATE_KEY:?缺少 MACOS_SIGNING_PRIVATE_KEY}"
: "${MACOS_SIGNING_CERTIFICATE:?缺少 MACOS_SIGNING_CERTIFICATE}"
sign_dir="$(mktemp -d "$RUNNER_TEMP/pixelsky-signing.XXXXXX")"
cert="$sign_dir/release.pem"
p12="$sign_dir/release.p12"
printf '%s\n' "$MACOS_SIGNING_CERTIFICATE" > "$cert"
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
{
  echo "CSC_LINK=$p12"
  echo "CSC_KEY_PASSWORD=$password"
  echo "PIXELSKY_MAC_IDENTITY=$identity"
} >> "$GITHUB_ENV"
