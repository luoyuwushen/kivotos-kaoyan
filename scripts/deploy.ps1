# 一键上线脚本（只需跑一次）
#
# 用法，在本文件夹里打开 PowerShell 执行：
#   powershell -ExecutionPolicy Bypass -File .\scripts\deploy.ps1 -Username 你的GitHub用户名
#
# 可选参数：
#   -Repo kivotos-kaoyan    仓库名（默认 kivotos-kaoyan）
#   -SkipBuild              跳过部署前的构建自检
#
# 脚本会做这些事：
#   1. 检查 git / node 环境
#   2. 初始化本地仓库（如果还没初始化）
#   3. 跑一次构建，确认没有报错（构建失败就不推，避免上线一个坏站点）
#   4. 提交全部改动
#   5. 关联远程仓库并推送
#
# 第一次推送时，浏览器会弹窗让你登录 GitHub 授权（这是 GitHub 的安全要求，
# 任何工具都无法替你完成）。授权一次之后，以后推送就不用再登录了。

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Username,

  [string]$Repo = 'kivotos-kaoyan',

  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

function Write-Step($n, $text) {
  Write-Host ''
  Write-Host "=== [$n] $text ===" -ForegroundColor Cyan
}

function Write-Ok($text) { Write-Host "  [ok] $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "  [注意] $text" -ForegroundColor Yellow }
function Write-Err2($text) { Write-Host "  [错误] $text" -ForegroundColor Red }

# 跑原生命令并把它的报错当普通文本打印。
# Windows PowerShell 5.1 会把原生命令写往 stderr 的内容包成异常记录弹出来，
# 这里统一收进来按文本输出，避免刷一堆 PowerShell 错误噪音盖住真正的提示。
function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [string[]]$Arguments = @(),
    [string]$Indent = '    '
  )
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $Command @Arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $old
  }
  foreach ($line in ($output -split "`r?`n")) {
    if ($line.Trim()) { Write-Host "$Indent$line" -ForegroundColor DarkGray }
  }
  return $code
}

# 切到仓库根目录（脚本在 scripts/ 下）
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Write-Host "项目目录：$root"

# ---------- 1. 环境检查 ----------
Write-Step 1 '检查环境'

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Write-Err2 '没有找到 git。请先安装 Git：https://git-scm.com/'
  exit 1
}
Write-Ok "git 已安装：$((git --version))"

if (-not $SkipBuild) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Err2 '没有找到 Node.js。请先安装：https://nodejs.org/'
    exit 1
  }
  Write-Ok "node 已安装：$((node -v))"
}

# 检查 git 身份（提交记录会用到）
$userName = git config user.name
$userEmail = git config user.email
if (-not $userName -or -not $userEmail) {
  Write-Warn2 '检测到 git 还没配置用户名/邮箱，正在按你的 GitHub 用户名设置…'
  git config user.name $Username
  git config user.email "$Username@users.noreply.github.com"
  Write-Ok "已设置：$Username <$Username@users.noreply.github.com>"
} elseif ($userEmail -eq 'dev@example.com') {
  Write-Warn2 "当前提交邮箱是占位值 dev@example.com，已改成 GitHub 的隐私邮箱。"
  git config user.email "$Username@users.noreply.github.com"
  Write-Ok "提交邮箱：$Username@users.noreply.github.com"
} else {
  Write-Ok "提交身份：$userName <$userEmail>"
}

# ---------- 2. 初始化仓库 ----------
Write-Step 2 '初始化本地仓库'

if (Test-Path (Join-Path $root '.git')) {
  Write-Ok '本地仓库已存在，跳过初始化'
} else {
  git init -b main | Out-Null
  Write-Ok '已执行 git init（分支 main）'
}

$currentBranch = (git rev-parse --abbrev-ref HEAD 2>$null)
if ($currentBranch -ne 'main') {
  git branch -M main
  Write-Ok "当前分支已切换为 main（原来是 $currentBranch）"
}

# ---------- 3. 构建自检 ----------
Write-Step 3 '构建自检'
if ($SkipBuild) {
  Write-Warn2 '已跳过构建自检'
} else {
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host '  正在安装依赖（第一次会慢一点）…'
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Err2 '依赖安装失败'; exit 1 }
  }
  npm run build
  if ($LASTEXITCODE -ne 0) {
    Write-Err2 '构建失败，已中止。修好报错再跑这个脚本，避免上线一个打不开的站点。'
    exit 1
  }
  Write-Ok '构建通过，产物在 dist/'
}

# ---------- 4. 提交 ----------
Write-Step 4 '提交改动'

git add -A
$staged = git diff --cached --name-only
if (-not $staged) {
  Write-Ok '没有需要提交的改动'
} else {
  $count = ($staged | Measure-Object).Count
  git commit -m "基沃托斯作战本部：28考研规划站" | Out-Null
  Write-Ok "已提交 $count 个文件"
}

# ---------- 5. 推送 ----------
Write-Step 5 '推送到 GitHub'

# 先探测代理：国内直连 github.com 经常被重置，而 git / PowerShell 不会自动读系统代理。
# 这里把系统代理读出来，只在本次 git 命令上临时套用，不写进任何配置文件。
function Get-GitProxyArgs {
  $reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction SilentlyContinue
  if (-not $reg -or $reg.ProxyEnable -ne 1 -or -not $reg.ProxyServer) { return $null }
  $server = [string]$reg.ProxyServer
  # 可能是 127.0.0.1:7897，也可能是 http=...;https=... 的形式
  if ($server -match '=') {
    $part = ($server -split ';' | Where-Object { $_ -match '^https?=' } | Select-Object -First 1)
    if ($part) { $server = ($part -split '=')[1] }
  }
  $url = if ($server -match '^\w+://') { $server } else { "http://$server" }
  # 端口真的在监听才用，否则套上会报一堆看不懂的错
  try {
    $port = ([uri]$url).Port
    $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  } catch { return $null }
  if (-not $listening) {
    Write-Warn2 "系统设置了代理 $url，但端口没在监听（代理软件没开？），本次不使用代理"
    return $null
  }
  Write-Ok "检测到可用代理，本次推送走代理：$url"
  return @('-c', "http.proxy=$url", '-c', "https.proxy=$url")
}

$gitProxy = Get-GitProxyArgs
if (-not $gitProxy) {
  Write-Host '  未使用代理。若推送报 Connection was reset，请先打开你的代理软件再重试。' -ForegroundColor DarkGray
}

$remoteUrl = "https://github.com/$Username/$Repo.git"

# 先确认「用户名 + 仓库」在 GitHub 上真的存在。
# 踩过的坑：用户把本机 git 的占位值（user.name=FPGA-Dev）当成 GitHub 用户名输进来，
# 结果一路推到不存在的地址才报错，白折腾一轮。这里提前查一次并把话说清楚。
function Test-GitHubRepo {
  # 参数名别用 $Name —— 它和 PowerShell 的自动变量 $Name 冲突，
  # 会让 URL 悄悄拼错成外部变量的值（这个坑真的踩过一次）。
  param([string]$RepoOwner, [string]$RepoName, [string[]]$ProxyArgs)
  $url = "https://api.github.com/repos/$RepoOwner/$RepoName"
  $curlArgs = @('-s', '-o', 'NUL', '-w', '%{http_code}', '-m', '20', $url)
  $proxyUrl = ($ProxyArgs | Where-Object { $_ -like 'https.proxy=*' } | Select-Object -First 1)
  if ($proxyUrl) { $curlArgs = @('--proxy', ($proxyUrl -replace '^https\.proxy=', '')) + $curlArgs }
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $code = (& curl.exe @curlArgs 2>$null | Out-String).Trim()
  } catch {
    $code = '000'
  } finally {
    $ErrorActionPreference = $old
  }
  if (-not $code) { $code = '000' }
  return $code
}

Write-Host '  正在确认仓库是否存在…' -ForegroundColor DarkGray
$repoCode = Test-GitHubRepo -RepoOwner $Username -RepoName $Repo -ProxyArgs $gitProxy

switch ($repoCode) {
  '200' { Write-Ok "仓库存在：https://github.com/$Username/$Repo" }
  '404' {
    Write-Err2 "GitHub 上找不到仓库 https://github.com/$Username/$Repo"
    Write-Host ''
    Write-Host '  两种可能：' -ForegroundColor Yellow
    Write-Host '   (1) 还没创建它 → 打开 https://github.com/new'
    Write-Host "       仓库名填 $Repo ，可见性选 Public ，不要勾选 Add a README file"
    Write-Host '   (2) 用户名填错了 → 打开 https://github.com/settings/profile'
    Write-Host '       看 Username 那一栏，然后用正确的用户名重跑：'
    Write-Host '         powershell -ExecutionPolicy Bypass -File .\scripts\deploy.ps1 -Username 正确的用户名' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '   提醒：本机 git 配置里的 user.name 是占位值，不是你的 GitHub 用户名，别照抄。' -ForegroundColor Yellow
    exit 1
  }
  '401' { Write-Warn2 'GitHub 返回 401。如果这个仓库是私有的，请改成 Public 再试。' }
  '000' {
    Write-Warn2 '连不上 GitHub API，跳过仓库检查（多半是代理没开）。'
  }
  default { Write-Warn2 "GitHub 返回 HTTP $repoCode，跳过仓库检查。" }
}

# 注意：Windows PowerShell 5.1 会把原生命令写往 stderr 的任何内容当成终止错误，
# 所以"可能失败"的调用（比如还没有 origin 时查远程地址）要临时放宽错误策略。
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$existingRemote = git remote get-url origin 2>$null
$ErrorActionPreference = $oldEap

if ($existingRemote) {
  if ($existingRemote -ne $remoteUrl) {
    Write-Warn2 "远程地址原本是 $existingRemote，已改成 $remoteUrl"
    git remote set-url origin $remoteUrl
  } else {
    Write-Ok "远程地址：$remoteUrl"
  }
} else {
  git remote add origin $remoteUrl
  Write-Ok "已关联远程仓库：$remoteUrl"
}

Write-Host ''
Write-Host '  接下来会尝试推送。如果弹出浏览器让你登录 GitHub，请点授权。' -ForegroundColor Yellow
Write-Host '  如果提示仓库不存在，说明你还没在 GitHub 上创建它——'
Write-Host "  请先打开 https://github.com/new 建一个名为 $Repo 的 Public 仓库（不要勾选 Add README），再重新跑这个脚本。" -ForegroundColor Yellow
Write-Host ''

$pushExit = Invoke-Native -Command 'git' -Arguments ($gitProxy + @('push', '-u', 'origin', 'main'))
if ($pushExit -ne 0) {
  Write-Err2 '推送失败。按下面的顺序排查：'
  Write-Host '   1. 报 Connection was reset / Failed to connect to github.com →'
  Write-Host '      你的代理软件没开。打开代理软件后重新跑这个脚本。'
  Write-Host '      （本脚本会自动读取 Windows 系统代理设置并使用它）'
  Write-Host '   2. 报 Repository not found / 404 → 你还没在 GitHub 上创建这个仓库。'
  Write-Host "      打开 https://github.com/new，仓库名填 $Repo，选 Public，"
  Write-Host '      不要勾选 Add a README file / .gitignore / license。'
  Write-Host '   3. 报 Authentication failed / 授权被取消 → 重新跑一次，在弹窗里点授权。'
  exit 1
}

Write-Ok '推送成功！'

# ---------- 完成 ----------
Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
Write-Host ' 代码已上传。还剩最后一步：打开 GitHub Pages' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green
Write-Host ''
Write-Host " 1. 打开 https://github.com/$Username/$Repo/settings/pages"
Write-Host ' 2. 在 Build and deployment 的 Source 里，选 GitHub Actions'
Write-Host " 3. 打开 https://github.com/$Username/$Repo/actions 看部署进度"
Write-Host '    等它变成绿色对勾（约 1 分钟）'
Write-Host ''
Write-Host ' 你的网站地址将是：' -NoNewline
Write-Host "https://$Username.github.io/$Repo/" -ForegroundColor Cyan
Write-Host ''
Write-Host ' 以后想更新内容：改完代码，再跑一次这个脚本就行。' -ForegroundColor Yellow
Write-Host ''
