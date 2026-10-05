# ChatBI 页面资源副本

本目录保存 ChatBI 的页面资源副本，供参考页面结构。它依赖后端路由和接口，不能作为独立前端应用或纯静态网站运行。

完整应用位于 [`../chatbi-smart-ask/`](../chatbi-smart-ask/)。运行步骤见[项目首页](../../README.md)和[首次体验指南](../chatbi-smart-ask/docs/first-query.md)。

| 文件 | 内容 |
| --- | --- |
| `templates/index.html` | 问数页面 |
| `templates/dashboard.html` | 图表大屏 |
| `templates/data_dev.html` | 数据开发页面 |
| `templates/datasources.html` | 数据源管理 |
| `static/app_shell.css` | 公共样式 |

修改当前运行的产品页面时，请以 `chatbi-smart-ask` 内的模板和静态资源为准。两套目录不是两项独立产品。
