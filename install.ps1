#Requires -Version 5.1
<#
.SYNOPSIS
    安装 / 卸载 dsh-plugin-office-markdown 到指定的 DSH profile。

.DESCRIPTION
    1) 把插件包复制进 <ProfileDir>\node_modules\dsh-plugin-office-markdown
    2) 只探测、不安装：检查本机每个 Python 解释器有没有 markitdown，打印出来。
       本脚本**不会自动 pip install 任何东西**。要装 markitdown，
       请重启 DSH 后打开 设置 → Office 转换，在插件自带的设置页里点
       「一键配置 MarkItDown 环境」——装哪个解释器由你当场选。
    3) 在 <ProfileDir>\cordis.patch.yml 末尾写入一个受管 insert 块（带 BEGIN/END 标记）
    4) 可选 -RegisterBundle：装成正规 bundle。把源码打成 tarball 放进
       <DSH 数据目录>\local-packages\，在 profile package.json 里同时登记
       dsh.profile.bundles 与 dependencies 的 file: 指向，再用 DSH 自带的 pnpm
       跑一次 install。只有这样装，插件才会出现在 DSH 的「设置 → 插件」页面，
       并且能拿到卸载按钮。此模式下不再写 cordis.patch.yml 受管块（bundle 自带
       一份），若检测到旧的受管块会被移除，避免同一插件被加载两次。

    所有被改动的文件都会先备份成 <文件名>.bak（固定文件名，每次覆盖，不会随时间累积）。

    -Uninstall 会：
      - 移除受管块、插件目录、package.json 登记；
      - 按 <用户目录>\.dsh\dsh-plugin-office-markdown.env.json 快照，把**由本插件**
        安装的包 pip uninstall 掉。没有快照（说明环境是用户自己装的，或从没用过
        一键配置）就一个包都不动；
      - 删掉卸载日志 <用户目录>\.dsh\dsh-plugin-office-markdown-removal.log
        （脱离宿主的看门狗写的记录；加 -KeepRemovalLog 可留着它）。

    插件运行时不留任何临时文件：每次转换只在源文件旁边写一个 .md，没有临时目录、
    没有登记表、没有缓存元数据。那个 .md 属于用户，本脚本和插件都不会去删它。

    受管块是纯 insert 条目。如果 DSH 插件管理（plugin_manager）之后往块里写过
    一条按 id 覆盖的状态行（- id: office-markdown / disabled: true|false），
    本脚本在重写受管块时会把它取出来原样放回，不会把“在插件管理里禁用”
    这个状态重置掉。

.PARAMETER ProfileDir
    DSH profile 目录，默认 $env:USERPROFILE\.dsh\profiles\desktop

.PARAMETER SourceDir
    插件源目录，默认脚本所在目录。

.PARAMETER SkipCopy
    只处理 cordis.patch.yml，不复制插件文件。

.PARAMETER SkipEnv
    跳过 Python 环境探测（纯打印用，脚本本来也不安装任何东西）。
    离线安装、或不想让脚本调用任何 Python 时用。

.PARAMETER Disabled
    写入插件 config 的 enabled: false（保持安装，但不注册任何工具/技能/守卫，
    效果等同于没装）。与插件管理写的 loader 层 disabled: true 是两套开关，
    两者都能达到“关闭”的效果。

.PARAMETER RegisterBundle
    装成正规 bundle：把源码打成 tarball 放进 <DSH 数据目录>\local-packages\，
    在 profile package.json 里同时登记 dsh.profile.bundles 与 dependencies 的
    file: 指向，再用 DSH 自带的 pnpm 跑一次 install。
    只有这样装，插件才会出现在 DSH 的「设置 → 插件」页面，并且能一键卸载。
    此模式下不再写 cordis.patch.yml 受管块（bundle 自带一份），
    若检测到旧的受管块会被移除，避免同一插件被加载两次。
    注意：pnpm 对 file: tarball 是按「路径 + 版本号」缓存的，改完 lib\*.js 之后
    必须先把 package.json 的 version 升一位，否则装上去的还是旧内容。

.PARAMETER KeepMarkitdown
    卸载时保留已经装好的 markitdown 及其依赖，不做 pip uninstall（只删快照）。

.PARAMETER KeepRemovalLog
    卸载时保留卸载日志 <DSH 数据目录>\dsh-plugin-office-markdown-removal.log。
    默认会删掉它：彻底卸载的语义就是不留东西。

.PARAMETER Uninstall
    移除受管 insert 块、插件目录、RegisterBundle 登记，按环境快照恢复 Python 环境，
    并删除卸载日志（除非给了 -KeepRemovalLog）。

.EXAMPLE
    Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
    & .\install.ps1
    & .\install.ps1 -Disabled
    & .\install.ps1 -SkipEnv                 # 完全不调用 Python
    & .\install.ps1 -Uninstall
    & .\install.ps1 -Uninstall -KeepMarkitdown
    & .\install.ps1 -Uninstall -KeepRemovalLog

    也可以直接用 Windows PowerShell 调用:
    powershell -ExecutionPolicy Bypass -File .\install.ps1

    注意: 本脚本自身带 UTF-8 BOM，请不要用会去掉 BOM 的编辑器重新保存它，
    否则 Windows PowerShell 5.1 会按 ANSI 解码，中文将变成乱码并导致语法错误。
#>
[CmdletBinding()]
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
    [string]$SourceDir = $PSScriptRoot,
    [switch]$SkipCopy,
    [switch]$SkipEnv,
    [switch]$Disabled,
    [switch]$RegisterBundle,
    [switch]$KeepMarkitdown,
    [switch]$KeepRemovalLog,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$PackageName = 'dsh-plugin-office-markdown'
$RowId = 'office-markdown'
$BeginMark = "# >>> $PackageName (managed block — keep the markers, edit only the values)"
$EndMark = "# <<< $PackageName"

# DSH 的数据目录：优先用 DSH 自己导出的 $env:DSH_HOME（数据目录不在默认位置时
# 这是唯一正确的答案），其次才是默认的 %USERPROFILE%\.dsh。插件宿主半边用
# lib/paths.js 做同一套回退，两边必须一致，否则会各写一份快照。
$DshHome = $env:DSH_HOME
if (-not $DshHome) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
$EnvSnapshotName = 'dsh-plugin-office-markdown.env.json'

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[ok]   $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }

function Backup-File([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $bak = "$Path.bak"
        Copy-Item -LiteralPath $Path -Destination $bak -Force
        Write-Step "已备份: $bak"
    }
}

function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Utf8([string]$Path, [string]$Text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Format-Bytes([double]$n) {
    if ($n -lt 1024) { return "$([int]$n) B" }
    if ($n -lt 1048576) { return "$([math]::Round($n / 1KB, 1)) KB" }
    if ($n -lt 1073741824) { return "$([math]::Round($n / 1MB, 1)) MB" }
    return "$([math]::Round($n / 1GB, 2)) GB"
}

function Get-PythonCandidateList {
    $list = @()
    $rtRoot = Join-Path $DshHome 'dsh-runtimes'
    if (Test-Path -LiteralPath $rtRoot) {
        Get-ChildItem -LiteralPath $rtRoot -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name |
            ForEach-Object {
                $p = Join-Path $_.FullName 'dependencies\python\python.exe'
                if (Test-Path -LiteralPath $p) {
                    $list += [pscustomobject]@{ Exe = $p; Pre = @(); Source = "DSH 自带运行时 ($($_.Name))" }
                }
            }
    }
    foreach ($name in @('python', 'python3')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -and $cmd.Source -notlike '*WindowsApps*') {
            $list += [pscustomobject]@{ Exe = $cmd.Source; Pre = @(); Source = '系统 PATH' }
        }
    }
    $pyLauncher = Get-Command 'py' -ErrorAction SilentlyContinue
    if ($pyLauncher -and $pyLauncher.Source) {
        $list += [pscustomobject]@{ Exe = $pyLauncher.Source; Pre = @('-3'); Source = '系统 PATH (py -3)' }
    }
    return $list
}

function Invoke-PyQuiet($cand, [string[]]$pyArgs) {
    $all = @($cand.Pre) + $pyArgs
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $out = & $cand.Exe @all 2>&1 } finally { $ErrorActionPreference = $prevEap }
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = (($out | Out-String).TrimEnd()) }
}

# 清临时文件的功能已移除：插件只在源文件旁边写一个 .md，不产生任何临时目录、
# 登记表或缓存元数据，因此没有需要脚本清理的东西。那个 .md 归用户所有。

Write-Host ""
Write-Host "=== $PackageName ===" -ForegroundColor White
Write-Step "profile: $ProfileDir"

if (-not (Test-Path -LiteralPath $ProfileDir)) {
    throw "找不到 profile 目录: $ProfileDir"
}

$patchPath = Join-Path $ProfileDir 'cordis.patch.yml'
$pkgJsonPath = Join-Path $ProfileDir 'package.json'
$moduleDir = Join-Path $ProfileDir "node_modules\$PackageName"
$envSnapshotPath = Join-Path $DshHome $EnvSnapshotName
$legacySnapshotPath = Join-Path $ProfileDir ".$EnvSnapshotName"
$removalLogPath = Join-Path $DshHome 'dsh-plugin-office-markdown-removal.log'

# ---------------------------------------------------------------- 卸载
if ($Uninstall) {
    if (Test-Path -LiteralPath $patchPath) {
        $text = Read-Utf8 $patchPath
        if ($text.Contains($BeginMark)) {
            Backup-File $patchPath
            $pattern = "(?ms)^\s*" + [regex]::Escape($BeginMark) + ".*?" + [regex]::Escape($EndMark) + "\r?\n?"
            $new = [regex]::Replace($text, $pattern, '')
            $new = $new.TrimEnd() + [Environment]::NewLine
            Write-Utf8 $patchPath $new
            Write-Ok "已从 cordis.patch.yml 移除受管块（块内的状态覆盖行一并移除）"
        } else {
            Write-Step "cordis.patch.yml 中没有受管块，跳过"
        }
    }
    if (Test-Path -LiteralPath $moduleDir) {
        Remove-Item -LiteralPath $moduleDir -Recurse -Force
        Write-Ok "已删除 $moduleDir"
    }
    if (Test-Path -LiteralPath $pkgJsonPath) {
        $json = Read-Utf8 $pkgJsonPath
        if ($json.Contains($PackageName)) {
            $obj = $json | ConvertFrom-Json
            $bundles = @($obj.dsh.profile.bundles) | Where-Object { $_ -ne $PackageName }
            $obj.dsh.profile.bundles = $bundles
            if ($obj.dependencies.PSObject.Properties.Name -contains $PackageName) {
                $obj.dependencies.PSObject.Properties.Remove($PackageName)
            }
            Backup-File $pkgJsonPath
            Write-Utf8 $pkgJsonPath ($obj | ConvertTo-Json -Depth 20)
            Write-Ok "已从 package.json 的 bundles/dependencies 移除登记"
        }
    }

    # 恢复 Python 环境。只认快照：快照里的包全是“由本插件安装或登记”的，
    # 没有快照就说明这台机器上的 markitdown 是用户自己装的，一个都不动。
    if (-not (Test-Path -LiteralPath $envSnapshotPath) -and (Test-Path -LiteralPath $legacySnapshotPath)) {
        Move-Item -LiteralPath $legacySnapshotPath -Destination $envSnapshotPath -Force
        Write-Step "已把旧版快照迁移到 $envSnapshotPath"
    }
    if (Test-Path -LiteralPath $envSnapshotPath) {
        if ($KeepMarkitdown) {
            Remove-Item -LiteralPath $envSnapshotPath -Force
            Write-Step "-KeepMarkitdown：保留已安装的 markitdown 及其依赖，只删除环境快照"
        } else {
            $snap = (Read-Utf8 $envSnapshotPath) | ConvertFrom-Json
            $added = @($snap.added)
            if ($added.Count -eq 0) {
                Write-Step "快照显示安装时没有新增任何 Python 包，无需恢复"
            } elseif (-not $snap.python -or -not (Test-Path -LiteralPath $snap.python)) {
                Write-Warn2 "快照里的 Python 已不存在（$($snap.python)），无法自动恢复。请手工执行："
                Write-Warn2 "  <任意 python> -m pip uninstall -y $($added -join ' ')"
            } else {
                Write-Step "正在从 $($snap.python) 卸载本插件安装的 $($added.Count) 个包..."
                $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { $out = & $snap.python -m pip uninstall -y --disable-pip-version-check @added 2>&1 } finally { $ErrorActionPreference = $prevEap }
                $code = $LASTEXITCODE
                $out | Where-Object { $_ -match 'Successfully uninstalled|not installed|^ERROR|Skipping' } |
                    ForEach-Object { Write-Step ("  " + $_.ToString().Trim()) }
                if ($code -eq 0) {
                    Write-Ok "已恢复 Python 环境（本插件安装的 $($added.Count) 个包已卸载）"
                } else {
                    Write-Warn2 "pip uninstall 退出码 $code，请手工检查残留"
                }
            }
            Remove-Item -LiteralPath $envSnapshotPath -Force
        }
    } else {
        Write-Step "没有环境快照：这台机器上的 Python 包不是由本插件安装或登记的，一个都不会卸载"
    }

    # 卸载日志：只有脱离宿主的看门狗会写它，而本插件被卸载之后，这台机器上已经没有
    # 本插件的代码会来收拾它（本脚本是唯一还能跑的东西）。彻底卸载顺手清掉。
    if ($KeepRemovalLog) {
        if (Test-Path -LiteralPath $removalLogPath) {
            Write-Step "-KeepRemovalLog：保留卸载日志 $removalLogPath"
        }
    } elseif (Test-Path -LiteralPath $removalLogPath) {
        Remove-Item -LiteralPath $removalLogPath -Force
        Write-Ok "已删除卸载日志 $removalLogPath"
    }

    Write-Host ""
    Write-Ok "卸载完成。重启 DSH 后完全生效（工具、技能、read 守卫、设置页都会消失）。"
    Write-Host "  说明：插件不产生任何临时文件，因此没有额外的东西要清。转换出来的 .md 归你所有，"
    Write-Host "        就在源文件旁边，想删就自己删。"
    return
}

# ---------------------------------------------------------------- 复制插件
if (-not $SkipCopy) {
    if (-not (Test-Path -LiteralPath (Join-Path $SourceDir 'package.json'))) {
        throw "源目录里没有 package.json: $SourceDir"
    }
    $nodeModules = Join-Path $ProfileDir 'node_modules'
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        New-Item -ItemType Directory -Force -Path $nodeModules | Out-Null
    }
    if (Test-Path -LiteralPath $moduleDir) {
        Remove-Item -LiteralPath $moduleDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $moduleDir | Out-Null
    $items = Get-ChildItem -LiteralPath $SourceDir -Force |
        Where-Object { $_.Name -notin @('install.ps1', '.git', '.gitignore', 'node_modules', '__pycache__') }
    foreach ($item in $items) {
        Copy-Item -LiteralPath $item.FullName -Destination $moduleDir -Recurse -Force
    }
    Get-ChildItem -LiteralPath $moduleDir -Recurse -Force -Directory |
        Where-Object { $_.Name -eq '__pycache__' } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "已复制插件到 $moduleDir"
} else {
    Write-Step "-SkipCopy：跳过文件复制"
}

# ---------------------------------------------------------------- Python 环境（只看，不装）
if ($SkipEnv) {
    Write-Step "-SkipEnv：跳过 Python 环境探测（本脚本本来也不安装任何东西）"
} else {
    Write-Host ""
    Write-Step "探测 Python 环境（只读，不会安装任何东西）..."
    $candidates = @(Get-PythonCandidateList)
    $activeEnv = $null

    if ($candidates.Count -eq 0) {
        Write-Warn2 "  没有找到任何 Python 解释器"
    }
    foreach ($cand in $candidates) {
        $pipProbe = Invoke-PyQuiet $cand @('-m', 'pip', '--version')
        $hasPip = ($pipProbe.Code -eq 0)
        $hasMkd = $false
        $mkdVersion = ''
        if ($hasPip) {
            $mkdProbe = Invoke-PyQuiet $cand @('-m', 'markitdown', '--help')
            $hasMkd = ($mkdProbe.Code -eq 0)
            if ($hasMkd) {
                $show = Invoke-PyQuiet $cand @('-m', 'pip', 'show', 'markitdown')
                $verLine = @($show.Out -split "\r?\n" | Where-Object { $_ -match '^Version:' } | Select-Object -First 1)
                if ($verLine.Count -gt 0) { $mkdVersion = ($verLine[0] -split ':', 2)[1].Trim() }
            }
        }
        $mark = if ($hasMkd) { '[已装]' } elseif ($hasPip) { '[未装]' } else { '[无pip]' }
        Write-Host "  $mark $($cand.Exe)  [$($cand.Source)]$(if ($mkdVersion) { "  markitdown $mkdVersion" })"
        if ($hasMkd -and -not $activeEnv) { $activeEnv = $cand }
    }

    Write-Host ""
    if ($activeEnv) {
        Write-Ok "当前会使用：$($activeEnv.Exe)（$($activeEnv.Source)）"
        Write-Step "插件按 pythonPrefer=auto 的顺序挑第一个装了 markitdown 的解释器，与本行一致。"
    } else {
        Write-Warn2 "没有任何解释器装了 markitdown：插件会使用内置兜底转换器（纯 Node，无需 Python，保真度有限）。"
    }
    Write-Host ""
    Write-Step "本脚本不安装 markitdown。要装请重启 DSH 后打开："
    Write-Step "  设置 → Office 转换 → 检查本机环境 → 选解释器 → 一键配置 MarkItDown 环境"
    Write-Step "  装完可以在同一页面的「试转一个文件」里确认转换链真的可用。"
    Write-Step "想固定用某一个解释器，在同一个页面或 cordis.patch.yml 里设置 pythonPath。"
}

# ---------------------------------------------------------------- 写 patch 块
$enabledValue = if ($Disabled) { 'false' } else { 'true' }
$block = @"
$BeginMark
- insert:
    - id: $RowId
      name: $PackageName
      config:
        enabled: $enabledValue
        tmpDir: ''
        converter: auto
        pythonPath: ''
        pythonPrefer: auto
        allowUvxDownload: true
        uvxExtras: 'markitdown[all]'
        fallbackEnabled: true
        guardReadTool: true
        probeTtlMs: 600000
        timeoutMs: 300000
        reuseFresh: true
        pruneStaleArtifacts: false
        maxPreviewChars: 4000
        maxRowsPerSheet: 400
        maxTableCols: 24
        maxCellsPerSheet: 20000
        registerSkill: true
        registerSettings: true
        autoAdoptEnv: true
        removeEnvOnUninstall: true
$EndMark
"@

if (-not (Test-Path -LiteralPath $patchPath)) {
    Write-Warn2 "cordis.patch.yml 不存在，将新建一个空数组文件"
    Write-Utf8 $patchPath "[]$([Environment]::NewLine)"
}

$text = Read-Utf8 $patchPath
Backup-File $patchPath

# DSH 插件管理在启用/禁用某个条目时会往 patch 里写一条“按 id 覆盖”的状态行，
# 它通常落在受管块内部。直接整块替换会把它抹掉，于是“在插件管理里禁用”这个
# 状态会在下次重跑安装脚本时被静默复位。这里先取出来，替换完再原样放回。
$statePattern = '(?m)^- id:\s*' + [regex]::Escape($RowId) + '\r?\n\s+(?:disabled|enabled):\s*(?:true|false)[^\r\n]*'
$stateMatch = [regex]::Match($text, $statePattern)
if ($stateMatch.Success) {
    $stateRow = $stateMatch.Value
    $block = $block.Replace($EndMark, $stateRow + [Environment]::NewLine + $EndMark)
    Write-Step "检测到插件管理写入的状态行，已随受管块一起保留: $($stateRow -replace '\r?\n', ' / ')"
}

if ($text.Contains($BeginMark)) {
    $pattern = "(?ms)^\s*" + [regex]::Escape($BeginMark) + ".*?" + [regex]::Escape($EndMark) + "\r?\n?"
    $text = [regex]::Replace($text, $pattern, $block.TrimEnd() + [Environment]::NewLine)
    Write-Ok "已更新 cordis.patch.yml 中的受管块 (enabled: $enabledValue)"
} else {
    $trimmed = $text.TrimEnd()
    $text = $trimmed + [Environment]::NewLine + [Environment]::NewLine + $block
    Write-Ok "已向 cordis.patch.yml 追加受管块 (enabled: $enabledValue)"
}
Write-Utf8 $patchPath $text

# ---------------------------------------------------------------- 可选：装成正规 bundle
if ($RegisterBundle) {
    if (-not (Test-Path -LiteralPath $pkgJsonPath)) { throw "找不到 profile package.json: $pkgJsonPath" }

    # 1) 读源码版本号
    $srcPkg = (Read-Utf8 (Join-Path $SourceDir 'package.json')) | ConvertFrom-Json
    $version = $srcPkg.version
    if (-not $version) { throw "源 package.json 里没有 version" }

    # 2) 打成 tarball（必须包含 package.json，否则 pnpm 会写一个占位 manifest）
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path -LiteralPath $tarExe)) { throw "找不到 tar.exe（需要 Windows 10 1803 及以上）: $tarExe" }
    $stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("om-pack-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $stagePkg = Join-Path $stageRoot 'package'
    New-Item -ItemType Directory -Force -Path $stagePkg | Out-Null
    foreach ($name in @('lib', 'cordis.patch.yml', 'README.md', 'LICENSE', 'package.json')) {
        $src = Join-Path $SourceDir $name
        if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $stagePkg -Recurse -Force }
    }
    Get-ChildItem -LiteralPath $stagePkg -Recurse -Force -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq '__pycache__' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $tarballTmp = Join-Path $stageRoot "$PackageName-$version.tgz"
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $tarExe -czf $tarballTmp -C $stageRoot package 2>&1 | Out-Null } finally { $ErrorActionPreference = $prevEap }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tarballTmp)) { throw "tar 打包失败（退出码 $LASTEXITCODE）" }

    # 3) 放进 <DSH 数据目录>\local-packages\
    $localPkgDir = Join-Path $DshHome 'local-packages'
    New-Item -ItemType Directory -Force -Path $localPkgDir | Out-Null
    $tarballDst = Join-Path $localPkgDir "$PackageName-$version.tgz"
    Copy-Item -LiteralPath $tarballTmp -Destination $tarballDst -Force
    Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
    Write-Ok "已生成 tarball: $tarballDst ($(Format-Bytes (Get-Item -LiteralPath $tarballDst).Length))"

    # 4) 两处登记：bundles（列出并启用）+ dependencies（DSH 靠它判定 installed/removable）
    $obj = (Read-Utf8 $pkgJsonPath) | ConvertFrom-Json
    $changed = $false
    $bundles = @($obj.dsh.profile.bundles)
    if ($bundles -notcontains $PackageName) { $obj.dsh.profile.bundles = $bundles + $PackageName; $changed = $true }
    $spec = "file:../../local-packages/$PackageName-$version.tgz"
    if (-not $obj.dependencies) {
        $obj | Add-Member -NotePropertyName 'dependencies' -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    if ($obj.dependencies.PSObject.Properties.Name -contains $PackageName) {
        if ($obj.dependencies.$PackageName -ne $spec) { $obj.dependencies.$PackageName = $spec; $changed = $true }
    } else {
        $obj.dependencies | Add-Member -NotePropertyName $PackageName -NotePropertyValue $spec
        $changed = $true
    }
    if ($changed) {
        Backup-File $pkgJsonPath
        Write-Utf8 $pkgJsonPath ($obj | ConvertTo-Json -Depth 20)
        Write-Ok "已登记 dsh.profile.bundles 与 dependencies（$spec）"
    } else {
        Write-Step "profile package.json 里已经是这个版本，跳过登记"
    }

    # 5) 用 DSH 自带的 pnpm 真装一次
    $dshPnpm = $null
    $rtRoot = Join-Path $DshHome 'dsh-runtimes'
    if (Test-Path -LiteralPath $rtRoot) {
        foreach ($d in (Get-ChildItem -LiteralPath $rtRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name)) {
            $nodeExe = Join-Path $d.FullName 'dependencies\node\bin\node.exe'
            foreach ($pc in @((Join-Path $d.FullName 'dependencies\pnpm\bin\pnpm.cjs'), (Join-Path $d.FullName 'dependencies\pnpm\dist\pnpm.mjs'))) {
                if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $pc)) {
                    $dshPnpm = [pscustomobject]@{ Node = $nodeExe; Entry = $pc; Runtime = $d.Name }
                    break
                }
            }
            if ($dshPnpm) { break }
        }
    }
    if (-not $dshPnpm) {
        Write-Warn2 "没有找到 DSH 自带的 pnpm，请手工安装依赖（漏了这一步插件不会出现在「插件」页）："
        Write-Warn2 "  cd `"$ProfileDir`""
        Write-Warn2 "  pnpm install"
    } else {
        Write-Step "正在用 $($dshPnpm.Runtime) 自带的 pnpm 安装依赖..."
        Push-Location -LiteralPath $ProfileDir
        try {
            $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try { $out = & $dshPnpm.Node $dshPnpm.Entry install --reporter=append-only 2>&1 } finally { $ErrorActionPreference = $prevEap }
            $code = $LASTEXITCODE
        } finally { Pop-Location }
        $out | ForEach-Object { Write-Step ("  " + $_.ToString().TrimEnd()) }
        if ($code -eq 0) { Write-Ok "pnpm install 完成" } else { Write-Warn2 "pnpm install 退出码 $code，请手工检查" }
    }

    # 6) bundle 模式不需要受管块（bundle 自带 cordis.patch.yml），删掉旧的避免重复加载
    if (Test-Path -LiteralPath $patchPath) {
        $ptext = Read-Utf8 $patchPath
        if ($ptext.Contains($BeginMark)) {
            $ppat = "(?ms)^\s*" + [regex]::Escape($BeginMark) + ".*?" + [regex]::Escape($EndMark) + "\r?\n?"
            $pnew = ([regex]::Replace($ptext, $ppat, '')).TrimEnd() + [Environment]::NewLine
            Write-Utf8 $patchPath $pnew
            Write-Ok "bundle 模式：已移除 cordis.patch.yml 里的受管块（bundle 自带一份，避免重复加载）"
        }
    }
}

Write-Host ""
Write-Ok "安装完成。"
Write-Host ""
Write-Host "下一步：" -ForegroundColor White
Write-Host "  1. 重启 DeepSeek Harness。"
Write-Host "     DSH 会热加载 cordis.patch.yml，但不会重新 import 已缓存的插件模块；"
Write-Host "     而且新版本第一次带来 dsh.client 声明，宿主必须重新扫描才会加载设置页。"
Write-Host "     所以首次安装、以及每次修改 lib\*.js 之后，都必须重启才会生效。"
Write-Host "  2. 打开 设置 → Office 转换，那里可以看到："
Write-Host "       - 当前用的是内置兜底还是本机 MarkItDown"
Write-Host "       - 本机每个 Python 解释器装了没有"
Write-Host "       - 一键配置 / 一键卸载 MarkItDown 环境"
Write-Host "  3. 让模型执行: read_office_as_markdown({ action: ""status"" })"
Write-Host "     它会列出插件看到的每一个 Python 环境，以及哪个装好了 markitdown。"
Write-Host "  4. 关闭插件（两种都有效，效果都是“等于没装”）："
Write-Host "       - DSH 插件管理里禁用 office-markdown（loader 层 disabled: true，立即生效）"
Write-Host "       - 或 & .\install.ps1 -Disabled -SkipCopy（插件 config 的 enabled: false，重启生效）"
Write-Host "  5. 彻底卸载: & .\install.ps1 -Uninstall"
Write-Host "     会删掉插件、受管块、设置页、卸载日志，并卸载本插件配置过的 Python 包。"
Write-Host "     用户自己装的 markitdown（没有环境快照）不会被碰。"
Write-Host "     想留着 markitdown: & .\install.ps1 -Uninstall -KeepMarkitdown"
Write-Host "     想留着卸载日志: & .\install.ps1 -Uninstall -KeepRemovalLog"
Write-Host "  6. 插件不产生任何临时文件：转换结果就是一个 .md，写在源文件旁边，"
Write-Host "     没有临时目录、登记表或缓存元数据。那个 .md 归你所有，什么时候删都行。"
Write-Host ""