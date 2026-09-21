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
  # 参数名刻意**不叫** $Username：在本机 PowerShell 里 $Username 会被解析成
  # Windows 登录名（$env:USERNAME），无论传什么进来都会被悄悄换掉。
  # 踩过这个坑，表现是「明明输入了正确用户名，却推到了别人的地址」。
  # 保留 -Username 作为别名，这样原来的调用方式照样能用。
  [Parameter(Mandatory = $true)]
  [Alias('Username')]
  [string]$GitHubUser,

  [string]$Repo = 'kivotos-kaoyan',

  [switch]$SkipBuild,

  # 默认**拒绝**把 .env.local 里的 Supabase 配置打进发布包。
  # 原因：GitHub Pages 是公开的，一旦把某个项目的 URL + anon key 编进 bundle，
  # 所有访客（包括陌生人）打开站点都会被指向那个项目、往那个库里写数据 ——
  # 那等于把你的备考记录放到一个别人也能写的地方。
  # 真要这么做（自己一个人用、就想打开即配好），显式加 -BakeSupabaseConfig。
  [switch]$BakeSupabaseConfig
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
# 注意：这里读的是本仓库已有的 git 配置，和 -GitHubUser 是两回事，别混用。
$gitName = git config user.name
$gitEmail = git config user.email
if (-not $gitName -or -not $gitEmail) {
  Write-Warn2 '检测到 git 还没配置用户名/邮箱，正在按你的 GitHub 用户名设置…'
  git config user.name $GitHubUser
  git config user.email "$GitHubUser@users.noreply.github.com"
  Write-Ok "已设置：$GitHubUser <$GitHubUser@users.noreply.github.com>"
} elseif ($gitEmail -eq 'dev@example.com') {
  Write-Warn2 '当前提交邮箱是占位值 dev@example.com，已改成 GitHub 的隐私邮箱。'
  git config user.email "$GitHubUser@users.noreply.github.com"
  Write-Ok "提交邮箱：$GitHubUser@users.noreply.github.com"
} else {
  Write-Ok "提交身份：$gitName <$gitEmail>"
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
  # 3a. 护栏：别把 .env.local 里的后端配置打进公开的发布包
  $envLocal = Join-Path $root '.env.local'
  if ((Test-Path $envLocal) -and -not $BakeSupabaseConfig) {
    $hasCloud = Select-String -Path $envLocal -Pattern 'VITE_SUPABASE_URL\s*=\s*https' -Quiet
    if ($hasCloud) {
      Write-Err2 '发现 .env.local 里配置了 Supabase，已中止构建。'
      Write-Host ''
      Write-Host '  为什么拦下来：GitHub Pages 是公开的。把项目地址与 anon key 编进' -ForegroundColor Yellow
      Write-Host '  发布包之后，所有访客打开站点都会被指向你的 Supabase 项目，' -ForegroundColor Yellow
      Write-Host '  也就是陌生人也能往那个库里写东西。' -ForegroundColor Yellow
      Write-Host ''
      Write-Host '  想让线上站点「打开即配好」、且只有你自己用 → 加 -BakeSupabaseConfig 再跑一次。' -ForegroundColor Cyan
      Write-Host '  想让每个使用者填自己的项目（推荐）→ 把 .env.local 改名成 .env.local.bak，' -ForegroundColor Cyan
      Write-Host '  再跑一次；线上站点会引导使用者在「设置 → 云端同步」里自己填。' -ForegroundColor Cyan
      exit 1
    }
  }
  if ((Test-Path $envLocal) -and $BakeSupabaseConfig) {
    Write-Warn2 '按你的要求，把 .env.local 里的 Supabase 配置打进了发布包（只有你自己用时才该这么做）'
  }

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

$remoteUrl = "https://github.com/$GitHubUser/$Repo.git"

# 先确认「用户名 + 仓库」在 GitHub 上真的存在。
# 踩过的坑：把本机 git 配置里的占位值（user.name=FPGA-Dev）当成 GitHub 用户名输进来，
# 结果一路推到不存在的地址才报错，白折腾一轮。这里提前查一次，把话说清楚。
#
# 这里刻意不封装成函数：PowerShell 里 $Name / $Username 这类变量容易和自动变量、
# 外层作用域串味，内联写反而最不容易出错。
$apiUrl = 'https://api.github.com/repos/' + $GitHubUser + '/' + $Repo
$curlArgs = @('-s', '-o', 'NUL', '-w', '%{http_code}', '-m', '20')
$proxyForCurl = ($gitProxy | Where-Object { $_ -like 'https.proxy=*' } | Select-Object -First 1)
if ($proxyForCurl) { $curlArgs += @('--proxy', ($proxyForCurl -replace '^https\.proxy=', '')) }
$curlArgs += $apiUrl

Write-Host ("  正在确认仓库是否存在… ($apiUrl)") -ForegroundColor DarkGray
$eapBackup = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$repoCode = (& curl.exe @curlArgs 2>$null | Out-String).Trim()
$ErrorActionPreference = $eapBackup
if (-not $repoCode) { $repoCode = '000' }

switch ($repoCode) {
  '200' { Write-Ok "仓库存在：https://github.com/$GitHubUser/$Repo" }
  '404' {
    Write-Err2 "GitHub 上找不到仓库 https://github.com/$GitHubUser/$Repo"
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
  '403' {
    Write-Warn2 'GitHub API 返回 403（多半是查询频率限制），跳过仓库检查，直接尝试推送。'
  }
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

# ---------- 6. 把构建产物同步到 gh-pages 分支 ----------
# 这样 Settings → Pages 里选「Deploy from a branch → gh-pages / (root)」就能直接发布，
# 不需要 GitHub Actions，也不需要任何 CI 配置。
Write-Step 6 '同步构建产物到 gh-pages 分支'

if ($SkipBuild) {
  Write-Warn2 '跳过了构建，dist/ 可能是旧的。先跑一次 npm run build 再同步才准确。'
}

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Write-Warn2 'dist/index.html 不存在，跳过 gh-pages 同步。请先运行 npm run build。'
} else {
  New-Item -ItemType File -Path (Join-Path $root 'dist\.nojekyll') -Force | Out-Null

  $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
  $oldEap2 = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'

  # 用底层命令构造一个只含 dist 内容的提交，全程不切换分支、不动工作区
  git read-tree --empty 2>$null | Out-Null
  git --work-tree=dist add -f -- . 2>$null | Out-Null
  $tree = (git write-tree).Trim()
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
  $commit = (git -c user.name="$GitHubUser" -c user.email="$GitHubUser@users.noreply.github.com" commit-tree $tree -m "构建产物更新 $stamp").Trim()
  git reset 2>$null | Out-Null   # 把索引还原回当前分支

  $ErrorActionPreference = $oldEap2

  if (-not $tree -or -not $commit) {
    Write-Warn2 '生成 gh-pages 提交失败，跳过。网页部署请改用 Source = GitHub Actions。'
  } else {
    git branch -f gh-pages $commit 2>$null
    $pagesExit = Invoke-Native -Command 'git' -Arguments ($gitProxy + @('push', '-f', 'origin', 'gh-pages'))
    if ($pagesExit -eq 0) {
      Write-Ok '已同步到 gh-pages 分支（Settings 里选它就是发布这个内容）'
    } else {
      Write-Warn2 'gh-pages 推送失败。网页部署请改用 Source = GitHub Actions，或在 Actions 页面手动 Run workflow。'
    }
    # 确认没有因为上面的底层操作把工作区搞乱
    if ((git rev-parse --abbrev-ref HEAD).Trim() -ne $currentBranch) {
      Write-Warn2 "当前分支意外变成了 $(git rev-parse --abbrev-ref HEAD)，正在切回 $currentBranch"
      git checkout $currentBranch 2>$null | Out-Null
    }
  }
}

# ---------- 完成 ----------
Write-Host ''
Write-Host '======================================================' -ForegroundColor Green
Write-Host ' 代码已上传。剩下最后一步：打开 GitHub Pages' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green
Write-Host ''
Write-Host " 打开 https://github.com/$GitHubUser/$Repo/settings/pages"
Write-Host ''
Write-Host ' 推荐选法（最简单，不需要任何 CI）：'
Write-Host '   Build and deployment → Source 选  Deploy from a branch'
Write-Host '   下面 Branch 选  gh-pages   ，目录选  / (root)   → Save' -ForegroundColor Cyan
Write-Host ''
Write-Host ' 另一种选法（用 GitHub Actions 自动构建）：'
Write-Host '   Source 选  GitHub Actions'
Write-Host '   然后到 Actions 页面点 Run workflow 手动跑一次'
Write-Host ''
Write-Host ' 两种选一种就行，别同时开。地址都是：' -NoNewline
Write-Host "https://$GitHubUser.github.io/$Repo/" -ForegroundColor Cyan
Write-Host ''
Write-Host ' 首次启用后大约 1 分钟生效；如果打开是 404，等一分钟再刷新。' -ForegroundColor Yellow
Write-Host ' 以后想更新内容：改完代码，再跑一次这个脚本就行。' -ForegroundColor Yellow
Write-Host ''
