---
title: Git 常用操作整理：分支、合并、回滚和冲突解决
slug: git-common-commands-branch-merge-rollback-conflict
date: 2021-08-21
category: 工具
tags:
  - Git
  - 开发工具
  - 版本控制
  - 团队协作
description: Git 是日常开发中最常用的版本控制工具。内容围绕分支创建、代码提交、合并、拉取、回滚、撤销、冲突解决和常见误操作处理，整理一份适合初级开发者日常查阅的 Git 操作笔记。
cover:
published: true
---

## Git 最常见的问题

刚开始用 Git，最容易遇到的不是复杂命令，而是这些场景：

```text
我改了代码但不想要了
我提交错分支了
我想撤销上一次提交
pull 之后冲突了
merge 之后代码乱了
想回滚线上某个 commit
不知道 reset 和 revert 该用哪个
```

Git 命令很多，但日常开发中高频使用的其实不多。

Git 官方文档可以查看：[Git Documentation](https://git-scm.com/doc)。如果只做普通业务开发，先把分支、提交、合并、回滚、冲突这几类操作掌握好就够用了。

图：IDEA Git 分支列表截图

![](images/2026/07/05/git-idea-branch-list-placeholder.png)

## 查看当前状态

最常用命令：

```bash
git status
```

它会告诉你：

```text
当前在哪个分支
哪些文件被修改
哪些文件已暂存
哪些文件未跟踪
是否有冲突
```

建议养成习惯：做任何危险操作前，先看一眼 `git status`。

查看提交记录：

```bash
git log --oneline --graph --decorate --all
```

这个命令比普通 `git log` 更适合看分支关系。

## 创建和切换分支

创建分支：

```bash
git branch feature/login
```

切换分支：

```bash
git checkout feature/login
```

更常用的一步到位：

```bash
git checkout -b feature/login
```

新版本 Git 也可以用：

```bash
git switch -c feature/login
```

查看所有分支：

```bash
git branch
```

查看远程分支：

```bash
git branch -r
```

删除本地分支：

```bash
git branch -d feature/login
```

如果分支没合并，Git 会阻止删除。确认不要了可以强删：

```bash
git branch -D feature/login
```

强删前一定确认分支代码不需要了。

## 提交代码的基本流程

日常提交一般是三步：

```bash
git status
git add .
git commit -m "feat: add login api"
```

更稳一点的流程：

```bash
# 先看改了哪些文件
git status

# 查看具体改动
git diff

# 只添加确认过的文件
git add src/main/java/com/example/LoginController.java

# 提交
git commit -m "feat: add login api"
```

不建议每次都无脑 `git add .`。

因为可能把这些文件一起提交进去：

```text
本地配置
临时日志
测试文件
IDE 缓存
.env 密钥文件
```

提交前可以用：

```bash
git diff --cached
```

查看已经暂存、即将提交的内容。

## 提交信息写清楚一点

不推荐：

```bash
git commit -m "update"
git commit -m "fix"
git commit -m "修改代码"
```

更推荐：

```bash
git commit -m "feat: add user login api"
git commit -m "fix: handle empty phone number"
git commit -m "refactor: simplify order query logic"
```

常见前缀：

| 前缀 | 含义 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 修复问题 |
| `refactor` | 重构 |
| `docs` | 文档 |
| `test` | 测试 |
| `chore` | 构建、配置、杂项 |

团队没有强规范也没关系，至少做到能看懂这次提交做了什么。

## 拉取远程代码

常用：

```bash
git pull
```

它相当于：

```bash
git fetch
git merge
```

更稳的做法是先 fetch：

```bash
git fetch origin
```

然后看远程变化：

```bash
git log --oneline HEAD..origin/main
```

再合并：

```bash
git merge origin/main
```

如果团队习惯线性提交历史，可能会用 rebase：

```bash
git pull --rebase
```

刚开始不熟 Git 时，先按团队规范来，不要自己随意 rebase 公共分支。

## 合并分支

假设当前在 `main` 分支，要合并 `feature/login`：

```bash
git checkout main
git pull
git merge feature/login
```

如果没有冲突，会生成合并提交或快进合并。

如果有冲突，Git 会提示哪些文件冲突。

查看冲突文件：

```bash
git status
```

解决完冲突后：

```bash
git add .
git commit
```

图：Git merge conflict 冲突文件截图

![](images/2026/07/05/git-merge-conflict-file-placeholder.png)

## 冲突长什么样

冲突文件里通常会出现：

```text
<<<<<<< HEAD
当前分支的代码
=======
被合并分支的代码
>>>>>>> feature/login
```

例如：

```java
public String getTitle() {
<<<<<<< HEAD
    return "订单列表";
=======
    return "我的订单";
>>>>>>> feature/order-title
}
```

你要手动改成最终想保留的内容：

```java
public String getTitle() {
    return "我的订单";
}
```

然后删除冲突标记。

解决冲突时不要只看当前几行，最好理解双方改动目的。尤其是业务代码，不要为了让冲突消失随便删一边。

## 放弃工作区修改

如果某个文件改错了，还没提交，想恢复成仓库版本：

```bash
git checkout -- src/main/java/com/example/UserService.java
```

新版本 Git 可以用：

```bash
git restore src/main/java/com/example/UserService.java
```

放弃所有未提交修改：

```bash
git restore .
```

危险：这会丢弃工作区修改，执行前先确认没有需要保留的代码。

如果文件已经 `git add` 暂存了，先取消暂存：

```bash
git restore --staged src/main/java/com/example/UserService.java
```

再恢复：

```bash
git restore src/main/java/com/example/UserService.java
```

## 修改最后一次提交

刚提交完发现漏了一个文件，可以：

```bash
git add missing-file.java
git commit --amend
```

如果只是改提交信息：

```bash
git commit --amend -m "fix: correct login validation"
```

注意：如果这个提交已经 push 到远程，并且别人可能基于它开发了，就不要随便 amend。

`amend` 会改写提交历史。

## reset 和 revert 怎么选

这是新手最容易混的地方。

### reset

`reset` 会移动当前分支指针，适合处理本地还没推送的提交。

回到上一个提交，并保留代码修改：

```bash
git reset --soft HEAD~1
```

回到上一个提交，代码回到工作区：

```bash
git reset --mixed HEAD~1
```

彻底丢弃上一个提交和代码：

```bash
git reset --hard HEAD~1
```

`--hard` 很危险，会直接丢代码。

### revert

`revert` 会生成一个新的提交，用来撤销某个历史提交。

适合已经 push 到远程的公共分支。

```bash
git revert <commitId>
```

选择建议：

```text
本地提交，还没 push：可以 reset
已经 push，别人可能拉了：优先 revert
```

图：git reset 和 git revert 提交历史对比截图

![](images/2026/07/05/git-reset-revert-history-placeholder.png)

## 提交错分支怎么办

场景：本来应该在 `feature/login` 开发，结果提交到了 `main`。

如果还没 push，可以这样处理。

先记住提交 ID：

```bash
git log --oneline -1
```

切到正确分支：

```bash
git checkout feature/login
```

把提交拿过来：

```bash
git cherry-pick <commitId>
```

再回到错误分支撤销：

```bash
git checkout main
git reset --hard HEAD~1
```

如果已经 push 到远程 main，不要直接 reset，需要按团队流程 revert 或提修复 MR。

## stash 临时保存修改

场景：你正在写代码，突然需要切分支修 bug，但当前代码还没写完，不想提交。

可以用 stash：

```bash
git stash push -m "login work in progress"
```

查看 stash：

```bash
git stash list
```

恢复最近一次 stash：

```bash
git stash pop
```

只应用不删除：

```bash
git stash apply stash@{0}
```

删除 stash：

```bash
git stash drop stash@{0}
```

stash 很方便，但不要长期堆很多。时间久了很容易忘记每个 stash 是什么。

## cherry-pick 拿某个提交

如果只想把某个提交拿到当前分支：

```bash
git cherry-pick <commitId>
```

常见场景：

```text
把 hotfix 提交同步到 release 分支
只拿功能分支里的某个修复
提交错分支后搬运提交
```

如果 cherry-pick 冲突，解决后执行：

```bash
git add .
git cherry-pick --continue
```

放弃 cherry-pick：

```bash
git cherry-pick --abort
```

## rebase 慎用但要理解

`merge` 会保留分支合并历史。

`rebase` 会把当前分支提交“挪到”目标分支后面，让历史更线性。

常用：

```bash
git checkout feature/login
git fetch origin
git rebase origin/main
```

如果冲突：

```bash
git add .
git rebase --continue
```

放弃：

```bash
git rebase --abort
```

注意：不要随便 rebase 已经推送到远程、并且别人正在使用的公共分支。

## 看某一行是谁改的

排查 bug 时很有用：

```bash
git blame src/main/java/com/example/UserService.java
```

它会显示每一行对应的提交和作者。

查看某个提交改了什么：

```bash
git show <commitId>
```

查看两个分支差异：

```bash
git diff main..feature/login
```

查看某个文件历史：

```bash
git log --oneline -- src/main/java/com/example/UserService.java
```

## 一个日常开发流程

比较常见的团队开发流程：

```bash
# 1. 更新主分支
git checkout main
git pull

# 2. 创建功能分支
git checkout -b feature/order-export

# 3. 开发后查看改动
git status
git diff

# 4. 提交代码
git add .
git commit -m "feat: add order export api"

# 5. 推送分支
git push origin feature/order-export
```

然后在代码平台上创建 Pull Request / Merge Request。

如果主分支有更新，可以同步：

```bash
git fetch origin
git rebase origin/main
```

或者按团队习惯 merge：

```bash
git merge origin/main
```

## 常见误操作处理

| 场景 | 命令 |
| --- | --- |
| 放弃某个文件修改 | `git restore file` |
| 取消暂存 | `git restore --staged file` |
| 修改最后一次提交 | `git commit --amend` |
| 本地撤销最后一次提交并保留修改 | `git reset --soft HEAD~1` |
| 本地彻底丢弃最后一次提交 | `git reset --hard HEAD~1` |
| 撤销已推送提交 | `git revert commitId` |
| 临时保存当前修改 | `git stash push -m "msg"` |
| 恢复 stash | `git stash pop` |
| 拿某个提交 | `git cherry-pick commitId` |
| 查看文件每行作者 | `git blame file` |

## 收尾

Git 不需要一开始掌握所有高级命令。日常开发先把这些能力用熟：

```text
status 看状态
diff 看改动
add 暂存
commit 提交
branch 管分支
merge 合并
stash 临时保存
reset 处理本地提交
revert 回滚远程提交
cherry-pick 拿单个提交
```

最重要的是：执行危险命令前先停一下。

尤其是这些命令：

```bash
git reset --hard
git push --force
git rebase
git branch -D
```

如果不确定影响范围，先问同事，或者先备份一个分支：

```bash
git branch backup-before-reset
```
