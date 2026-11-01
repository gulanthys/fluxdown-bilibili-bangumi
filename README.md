# FluxDown Bilibili Bangumi Plugin

此仓库专门维护 FluxDown 的 Bilibili 插件源码。番剧归档/分类插件由独立仓库 [fluxdown-anime-archive](https://github.com/gulanthys/fluxdown-anime-archive) 维护。

## 插件

| FluxDown identity | 目录 | 版本 | 功能 |
| --- | --- | --- | --- |
| `fluxdown@bilibili-bangumi` | [`bilibili-bangumi/`](./bilibili-bangumi/) | `1.1.1` | 解析番剧、普通视频及短链；番剧和 UP 主订阅共用插件设置；可移植二维码登录及登录态恢复（FD ≥ 0.6.4） |

## 目录结构

```text
fluxdown-bilibili-bangumi/
├── README.md
└── bilibili-bangumi/
    ├── README.md
    ├── manifest.json
    ├── auth.js
    ├── resolve.js
    ├── src/
    └── scripts/
```

## 插件包格式

FluxDown 插件发布包是一个 ZIP 格式的归档文件，通常使用 `.fxplug` 扩展名。压缩包根目录必须直接包含 `manifest.json`，例如：

```text
plugin.fxplug
├── manifest.json
└── resolve.js
```

安装器会读取并校验 `manifest.json`，然后将插件安装到 FluxDown 的插件目录中。开发目录安装则要求选择直接包含 `manifest.json` 的插件目录。

当前 GPUI 与 Web 客户端可直接安装 `.fxplug`；发布包须包含 manifest 声明的 `resolve.js`、`auth.js` 和 `main.js`。

## 开发与维护流程

新增或更新插件时，建议按以下顺序操作：

1. 在仓库根目录创建插件目录。
2. 编写 `manifest.json`，确定 identity、版本、匹配规则和设置项。
3. 编写入口脚本及辅助文件。
4. 为插件补充自己的 README，记录功能、配置、安装和限制。
5. 使用 FluxDown 的开发目录安装功能进行本地验证。
6. 验证正常后，将插件目录打包为 `.fxplug`。
7. 更新插件版本、发布包和索引记录，确保版本号保持一致。

## manifest 要点

`manifest.json` 至少需要准确描述：

- `identity`：插件的稳定唯一标识；
- `name`、`version`、`description`：插件展示信息；
- `minAppVersion`：最低 FluxDown 版本；
- `resolvers`：链接匹配规则、入口文件和解析超时时间；
- `subscriptions`：订阅 provider ID、入口文件和订阅超时时间；
- `contributes.archive`：文件名归档回调（需 `archive` 权限；只在 FD 自有分类目录规则匹配后选择单层子目录）；
- `settings`：插件可配置的设置项。

插件入口应通过 FluxDown 插件运行时提供的能力完成网络请求、存储和结果返回，不应依赖宿主客户端内部文件路径或未声明的接口。

## 版本管理

- 插件版本使用语义化版本号，例如 `0.1.0`。
- 修改用户可见功能或兼容行为时，应更新插件版本。
- `manifest.json`、插件目录说明和发布包中的版本必须一致。
- 不同插件各自独立版本，不要求整个仓库使用单一版本号。

## 安全与隐私

- 不要把 Cookie、Token、密码或其他登录凭据提交到仓库。
- 插件应限制网络请求范围，并对外部响应进行基本校验。
- 用户数据只在实现确有必要时存储，并在插件 README 中说明用途。
- 发布前检查压缩包，确认没有临时文件、调试日志或本地配置。

## 发布前检查清单

- [ ] 插件目录中存在 `manifest.json` 和入口脚本。
- [ ] `manifest.json` 可以被 FluxDown 校验并且版本号正确。
- [ ] 链接匹配规则覆盖目标页面，但不会误匹配无关链接。
- [ ] 网络失败、接口错误和空结果都有明确错误信息。
- [ ] 文件名和路径经过安全清理。
- [ ] Cookie、Token 和本机路径未进入源码或发布包。
- [ ] 已通过开发目录安装和 `.fxplug` 安装验证。
- [ ] 插件 README 已同步更新。
