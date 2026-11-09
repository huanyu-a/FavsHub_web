# 测试夹具（fixtures）

这里放**测试专用的固定输入**，不是产品资源。

## `tls-pinned-test.{crt,key}.pem`

`scripts/ssrf-pin-check.mjs` 用的自签证书，`CN=pinned-test.local`，
`subjectAltName=DNS:pinned-test.local`，**有效期到 2036-11-06**。

用途：给「地址钉死（pin）之后，TLS 的 SNI 与主机名校验必须照常工作」那条断言
提供一个**本地、离线、确定性**的靶标 —— 正例（主机名与证书一致 → 连得上）
与负例（主机名不符 → 必须被拒）都用它。

**为什么是固定文件而不是运行时 `openssl` 现场签一张**（2026-11-09 的改动）：

- 现场签让这条断言多了一个**与测试目标无关的外部依赖**。虽然当时的处理是
  「缺 openssl 就如实报红、拒绝静默跳过」（那是对的），但随之而来一个更隐蔽的问题：
  **「没有 openssl 时那条分支到底对不对」在装了 openssl 的开发机上永远不会被验证**。
- 换成固定夹具后，这条分支**被整个删掉**：任何有 Node 的环境行为完全一致。
  用空 `PATH` 复跑可自证：`env -i PATH=/tmp/emptybin node scripts/ssrf-pin-check.mjs`。

**这把私钥是公开的、故意入库的**（自签测试证书，任何人不持有任何真实凭据），
不要把它复制到其它用途。套件里有一条断言会读证书的 `notAfter`，
**过期即报红**并直接告诉你该换证书了 —— 免得 2036 年那天以「TLS 校验失败」的形式莫名报红。

重新生成：

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout scripts/fixtures/tls-pinned-test.key.pem \
  -out    scripts/fixtures/tls-pinned-test.crt.pem \
  -subj '/CN=pinned-test.local' -addext 'subjectAltName=DNS:pinned-test.local'
```
