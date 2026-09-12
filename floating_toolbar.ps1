param([switch]$Test, [string]$Screenshot, [string]$Theme = "dark", [string]$ModalScreenshot = "", [string]$ModalType = "callback")

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$script:dataDir = Join-Path $PSScriptRoot "data"
if (!(Test-Path $script:dataDir)) { New-Item -ItemType Directory -Path $script:dataDir -Force | Out-Null }
$script:dataFile = Join-Path $script:dataDir "shifts.json"
$script:sessionFile = Join-Path $script:dataDir "active_session.json"
$script:callbacksFile = Join-Path $script:dataDir "callbacks.json"
$script:callsFile = Join-Path $script:dataDir "calls.json"
$script:salesRepsFile = Join-Path $script:dataDir "sales_reps.json"
$script:backupDir = Join-Path $script:dataDir "backups"
if (!(Test-Path $script:backupDir)) { New-Item -ItemType Directory -Path $script:backupDir -Force | Out-Null }
$script:historyDir = Join-Path $script:dataDir "history"
if (!(Test-Path $script:historyDir)) { New-Item -ItemType Directory -Path $script:historyDir -Force | Out-Null }

$script:versionFile = Join-Path $PSScriptRoot "version.json"
$script:appVersion = "1.5.0"
$script:appBuild = "2026.09.11-rev2"
if (Test-Path $script:versionFile) {
    try {
        $vData = Get-Content $script:versionFile -Raw | ConvertFrom-Json
        if ($vData.version) { $script:appVersion = $vData.version }
        if ($vData.build) { $script:appBuild = $vData.build }
    } catch {}
}

$script:defaultSalesReps = @(
    "Representative 1",
    "Representative 2",
    "Representative 3",
    "Lead Coordinator"
)

# Create a daily startup backup if shifts.json exists
if (Test-Path $script:dataFile) {
    try {
        $todayStartupBackup = Join-Path $script:backupDir ("shifts_backup_startup_" + (Get-Date).ToString("yyyyMMdd") + ".json")
        if (!(Test-Path $todayStartupBackup)) {
            Copy-Item -Path $script:dataFile -Destination $todayStartupBackup -Force
        }
    } catch {}
}

# State object
$script:state = @{
    Status = "OFFLINE"   # OFFLINE, RUNNING, PAUSED
    StartTime = 0
    PauseStartTime = 0
    TotalPausedMs = 0
    LastActivitySwitchTime = 0
    CurrentActivity = "off_phone_work"
    ActivityMap = @{
        inbound_call = 0
        outbound_call = 0
        text_sms = 0
        email_in = 0
        off_phone_work = 0
    }
    EventCounts = @{
        inbound_call = 0
        outbound_call = 0
        text_sms = 0
        email_in = 0
        off_phone_work = 0
    }
    Events = @()
    TodayAppts = 0
    TodayDate = (Get-Date).ToString("yyyy-MM-dd")
    Theme = "dark"
}

# Load saved session if exists
if (Test-Path $script:sessionFile) {
    try {
        $saved = Get-Content $script:sessionFile -Raw | ConvertFrom-Json
        if ($saved.TodayDate -eq $script:state.TodayDate) {
            $script:state.Status = $saved.Status
            $script:state.StartTime = $saved.StartTime
            $script:state.PauseStartTime = $saved.PauseStartTime
            $script:state.TotalPausedMs = $saved.TotalPausedMs
            $script:state.LastActivitySwitchTime = $saved.LastActivitySwitchTime
            $script:state.CurrentActivity = $saved.CurrentActivity
            $script:state.TodayAppts = $saved.TodayAppts
            if ($saved.ActivityMap) {
                $saved.ActivityMap.psobject.properties | ForEach-Object {
                    $script:state.ActivityMap[$_.Name] = $_.Value
                }
            }
            if ($saved.EventCounts) {
                $saved.EventCounts.psobject.properties | ForEach-Object {
                    $script:state.EventCounts[$_.Name] = $_.Value
                }
            }
            if ($saved.Events) {
                $script:state.Events = @($saved.Events)
            }
        }
        if ($saved.Theme -and !$PSBoundParameters.ContainsKey('Theme')) {
            $script:state.Theme = $saved.Theme
            $Theme = $saved.Theme
        }
    } catch {}
}

# Auto-start tracking on launch so no 2nd action is needed
if ($script:state.Status -eq "OFFLINE") {
    $now = [Math]::Floor([double](Get-Date -UFormat %s) * 1000)
    $script:state.StartTime = $now
    $script:state.LastActivitySwitchTime = $now
    $script:state.PauseStartTime = 0
    $script:state.TotalPausedMs = 0
    $script:state.Status = "RUNNING"
}

# XAML Definition
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Sabrina Transport Bar"
        Width="600" Height="165"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterScreen">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Name="btnBorder" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="5" Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsEnabled" Value="False">
                                <Setter TargetName="btnBorder" Property="Opacity" Value="0.32"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>
    <Border Name="MainBorder" Background="#1E293B" BorderBrush="#334155" BorderThickness="1.5" CornerRadius="10" Padding="10,6,10,8">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="28"/>
                <RowDefinition Height="52"/>
                <RowDefinition Height="*"/>
            </Grid.RowDefinitions>

            <!-- Top Header & Drag Handle -->
            <Grid Grid.Row="0" Name="HeaderBar" Background="Transparent">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="Auto"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>

                <StackPanel Name="DragHandleLeft" Grid.Column="0" Orientation="Horizontal" VerticalAlignment="Center" Cursor="SizeAll" ToolTip="Click and drag to move toolbar">
                    <Ellipse Name="LedIndicator" Width="10" Height="10" Fill="#64748B" Margin="0,0,6,0"/>
                    <TextBlock Name="TxtStatus" Text="OFFLINE" Foreground="#94A3B8" FontWeight="Bold" FontSize="11" Margin="0,0,8,0" VerticalAlignment="Center"/>
                    <TextBlock Name="TxtClock" Text="12:00 PM" Foreground="#64748B" FontSize="11" VerticalAlignment="Center"/>
                </StackPanel>

                <!-- Center Drag Grip Area -->
                <Border Name="DragHandleCenter" Grid.Column="1" Background="Transparent" Cursor="SizeAll" ToolTip="Click and drag to move toolbar"/>

                <StackPanel Grid.Column="2" Orientation="Horizontal" VerticalAlignment="Center" Cursor="Arrow">
                    <!-- Theme Switcher Button -->
                    <Button Name="BtnTheme" Content="Theme: Dark" Background="#334155" Foreground="#CBD5E1" FontWeight="SemiBold" FontSize="10" Padding="5,2" BorderThickness="1" BorderBrush="#475569" Margin="0,0,5,0" Cursor="Hand" ToolTip="Switch Theme: Dark, Light, High-Vis"/>

                    <!-- Appts Counter (Whole badge is clickable) -->
                    <Border Name="ApptBorder" Background="#0F172A" BorderBrush="#334155" BorderThickness="1" CornerRadius="4" Padding="6,2" Margin="0,0,5,0" Cursor="Hand" ToolTip="Click to book appointment (+1)">
                        <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                            <TextBlock Name="TxtApptLabel" Text="APPT: " Foreground="#94A3B8" FontSize="10" FontWeight="Bold" VerticalAlignment="Center"/>
                            <TextBlock Name="TxtAppts" Text="0" Foreground="#22C55E" FontSize="11" FontWeight="Bold" Margin="0,0,5,0" VerticalAlignment="Center"/>
                            <Button Name="BtnApptPlus" Content="+" Background="#22C55E" Foreground="White" Width="20" Height="18" FontWeight="Bold" FontSize="12" BorderThickness="0" Cursor="Hand" ToolTip="Book Appointment"/>
                        </StackPanel>
                    </Border>

                    <!-- Advanced View Button -->
                    <Button Name="BtnAdvanced" Content="Advanced" Background="#1E3A8A" Foreground="#93C5FD" FontWeight="Bold" FontSize="10" Padding="6,2" BorderThickness="1" BorderBrush="#2563EB" Margin="0,0,5,0" Cursor="Hand" ToolTip="Open Full Invoices &amp; Timesheets"/>

                    <!-- Minimize and Close -->
                    <Button Name="BtnMin" Content="&#x2014;" Background="Transparent" Foreground="#94A3B8" FontWeight="Bold" FontSize="11" Width="18" Height="18" BorderThickness="0" Margin="0,0,2,0" Cursor="Hand"/>
                    <Button Name="BtnClose" Content="&#x2715;" Background="Transparent" Foreground="#94A3B8" FontWeight="Bold" FontSize="11" Width="18" Height="18" BorderThickness="0" Cursor="Hand"/>
                </StackPanel>
            </Grid>

            <!-- Middle Transport Controls & Digits -->
            <Grid Grid.Row="1" Margin="0,2,0,4">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="Auto"/>
                    <ColumnDefinition Width="*"/>
                </Grid.ColumnDefinitions>

                <!-- Action Buttons: Green, Yellow/Amber, Red -->
                <StackPanel Grid.Column="0" Orientation="Horizontal" VerticalAlignment="Center">
                    <Button Name="BtnRec" Content="REC" Background="#16A34A" Foreground="White" FontWeight="Bold" FontSize="13" Padding="14,8" BorderThickness="0" Margin="0,0,5,0" Cursor="Hand"/>
                    <Button Name="BtnPause" Content="PAUSE" Background="#D97706" Foreground="White" FontWeight="Bold" FontSize="13" Padding="12,8" BorderThickness="0" Margin="0,0,5,0" IsEnabled="False" Cursor="Hand"/>
                    <Button Name="BtnStop" Content="STOP" Background="#DC2626" Foreground="White" FontWeight="Bold" FontSize="13" Padding="12,8" BorderThickness="0" IsEnabled="False" Cursor="Hand"/>
                </StackPanel>

                <!-- Luminous Digits Readout -->
                <Border Name="DigitsBorder" Grid.Column="1" Background="#090D16" BorderBrush="#334155" BorderThickness="1" CornerRadius="6" Margin="8,0,0,0" Padding="8,4">
                    <Grid>
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="1"/>
                            <ColumnDefinition Width="*"/>
                        </Grid.ColumnDefinitions>

                        <StackPanel Grid.Column="0" HorizontalAlignment="Center" VerticalAlignment="Center">
                            <TextBlock Name="TxtSessionLabel" Text="SESSION" Foreground="#64748B" FontSize="8" FontWeight="Bold" HorizontalAlignment="Center"/>
                            <TextBlock Name="TxtSessionDigits" Text="00:00:00" Foreground="#38BDF8" FontFamily="Courier New" FontSize="16" FontWeight="Bold" HorizontalAlignment="Center"/>
                        </StackPanel>

                        <Rectangle Name="DigitsDivider" Grid.Column="1" Fill="#1E293B" Width="1" Margin="2,2"/>

                        <StackPanel Grid.Column="2" HorizontalAlignment="Center" VerticalAlignment="Center">
                            <TextBlock Name="TxtTodayLabel" Text="TODAY TOTAL" Foreground="#64748B" FontSize="8" FontWeight="Bold" HorizontalAlignment="Center"/>
                            <TextBlock Name="TxtTodayDigits" Text="0h 00m" Foreground="#4ADE80" FontFamily="Courier New" FontSize="16" FontWeight="Bold" HorizontalAlignment="Center"/>
                        </StackPanel>
                    </Grid>
                </Border>
            </Grid>

            <!-- Bottom Activity Buttons Strip: Green, Blue, Yellow, Purple, Slate, Amber/Alert -->
            <Grid Grid.Row="2" Margin="0,3,0,0">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="1.15*"/>
                </Grid.ColumnDefinitions>

                <Button Name="BtnActInbound" Grid.Column="0" Content="Inbound Call" Background="#064E3B" Foreground="#6EE7B7" BorderBrush="#047857" FontWeight="SemiBold" FontSize="10" Margin="0,0,3,0" BorderThickness="1" Cursor="Hand"/>
                <Button Name="BtnActOutbound" Grid.Column="1" Content="Outbound Call" Background="#1E3A8A" Foreground="#93C5FD" BorderBrush="#2563EB" FontWeight="SemiBold" FontSize="10" Margin="0,0,3,0" BorderThickness="1" Cursor="Hand"/>
                <Button Name="BtnActText" Grid.Column="2" Content="Text SMS" Background="#78350F" Foreground="#FDE047" BorderBrush="#D97706" FontWeight="SemiBold" FontSize="10" Margin="0,0,3,0" BorderThickness="1" Cursor="Hand"/>
                <Button Name="BtnActEmail" Grid.Column="3" Content="Email" Background="#4C1D95" Foreground="#E9D5FF" BorderBrush="#7C3AED" FontWeight="SemiBold" FontSize="10" Margin="0,0,3,0" BorderThickness="1" Cursor="Hand"/>
                <Button Name="BtnActAdmin" Grid.Column="4" Content="Admin Work" Background="#0284C7" Foreground="White" BorderBrush="#0369A1" FontWeight="Bold" FontSize="10" Margin="0,0,3,0" BorderThickness="1" Cursor="Hand"/>
                <Button Name="BtnActCallbacks" Grid.Column="5" Content="Callbacks (0)" Background="#78350F" Foreground="#FDE047" BorderBrush="#D97706" FontWeight="Bold" FontSize="10" BorderThickness="1" Cursor="Hand" ToolTip="Click to view/add callback reminders"/>
            </Grid>
        </Grid>
    </Border>
</Window>
"@

$reader = (New-Object System.Xml.XmlNodeReader $xaml)
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Element References
$MainBorder      = $window.FindName("MainBorder")
$HeaderBar       = $window.FindName("HeaderBar")
$LedIndicator    = $window.FindName("LedIndicator")
$TxtStatus       = $window.FindName("TxtStatus")
$TxtClock        = $window.FindName("TxtClock")
$BtnTheme        = $window.FindName("BtnTheme")
$ApptBorder      = $window.FindName("ApptBorder")
$TxtApptLabel    = $window.FindName("TxtApptLabel")
$TxtAppts        = $window.FindName("TxtAppts")
$BtnApptPlus     = $window.FindName("BtnApptPlus")
$BtnAdvanced     = $window.FindName("BtnAdvanced")
$BtnMin          = $window.FindName("BtnMin")
$BtnClose        = $window.FindName("BtnClose")
$BtnRec          = $window.FindName("BtnRec")
$BtnPause        = $window.FindName("BtnPause")
$BtnStop         = $window.FindName("BtnStop")
$DigitsBorder    = $window.FindName("DigitsBorder")
$DigitsDivider   = $window.FindName("DigitsDivider")
$TxtSessionLabel = $window.FindName("TxtSessionLabel")
$TxtSessionDigits= $window.FindName("TxtSessionDigits")
$TxtTodayLabel   = $window.FindName("TxtTodayLabel")
$TxtTodayDigits  = $window.FindName("TxtTodayDigits")
$BtnActInbound   = $window.FindName("BtnActInbound")
$BtnActOutbound  = $window.FindName("BtnActOutbound")
$BtnActText      = $window.FindName("BtnActText")
$BtnActEmail     = $window.FindName("BtnActEmail")
$BtnActAdmin     = $window.FindName("BtnActAdmin")
$BtnActCallbacks = $window.FindName("BtnActCallbacks")

$activityButtons = @{
    inbound_call   = $BtnActInbound
    outbound_call  = $BtnActOutbound
    text_sms       = $BtnActText
    email_in       = $BtnActEmail
    off_phone_work = $BtnActAdmin
}

# Color palette for buttons: Green, Blue, Yellow/Amber, Purple, Slate
$activityPalette = @{
    inbound_call   = @{ ActiveBg = "#10B981"; InactiveBg = "#064E3B"; InactiveFg = "#6EE7B7"; Border = "#047857" }
    outbound_call  = @{ ActiveBg = "#2563EB"; InactiveBg = "#1E3A8A"; InactiveFg = "#93C5FD"; Border = "#2563EB" }
    text_sms       = @{ ActiveBg = "#D97706"; InactiveBg = "#78350F"; InactiveFg = "#FDE047"; Border = "#D97706" }
    email_in       = @{ ActiveBg = "#7C3AED"; InactiveBg = "#4C1D95"; InactiveFg = "#E9D5FF"; Border = "#7C3AED" }
    off_phone_work = @{ ActiveBg = "#0284C7"; InactiveBg = "#0F172A"; InactiveFg = "#E2E8F0"; Border = "#334155" }
}

# Drag handles (left and center only, keeping buttons free from drag triggers)
$DragHandleLeft  = $window.FindName("DragHandleLeft")
$DragHandleCenter = $window.FindName("DragHandleCenter")

if ($DragHandleLeft) {
    $DragHandleLeft.Add_MouseLeftButtonDown({ $window.DragMove() })
}
if ($DragHandleCenter) {
    $DragHandleCenter.Add_MouseLeftButtonDown({ $window.DragMove() })
}

# Window controls
$BtnMin.Add_Click({ $window.WindowState = [System.Windows.WindowState]::Minimized })
$BtnClose.Add_Click({ $window.Close() })

# Advanced View Button: Launches full dashboard for invoices, detailed timesheets & Telus tools
$BtnAdvanced.Add_Click({
    $indexPath = Join-Path $PSScriptRoot "index.html"
    Start-Process "file:///$indexPath"
})

# Appointments Counter - Click either "+" button or entire APPT badge
$BtnApptPlus.Add_Click({
    Show-QuickApptModal
})
$ApptBorder.Add_MouseLeftButtonDown({
    Show-QuickApptModal
})

# Theme Switcher Engine: Dark, Light, High-Vis
$script:themes = @("dark", "light", "highvis")
$script:themeIndex = [System.Array]::IndexOf($script:themes, $script:state.Theme.ToLower())
if ($script:themeIndex -lt 0) { $script:themeIndex = 0 }

function Apply-Theme($themeName) {
    $bc = [System.Windows.Media.BrushConverter]::new()
    $script:state.Theme = $themeName

    if ($themeName -eq "dark") {
        $BtnTheme.Content = "Theme: Dark"
        $MainBorder.Background = $bc.ConvertFromString("#1E293B")
        $MainBorder.BorderBrush = $bc.ConvertFromString("#334155")
        $MainBorder.BorderThickness = [System.Windows.Thickness]::new(1.5)
        $DigitsBorder.Background = $bc.ConvertFromString("#090D16")
        $DigitsBorder.BorderBrush = $bc.ConvertFromString("#334155")
        $DigitsDivider.Fill = $bc.ConvertFromString("#1E293B")
        $ApptBorder.Background = $bc.ConvertFromString("#0F172A")
        $ApptBorder.BorderBrush = $bc.ConvertFromString("#334155")
        $TxtClock.Foreground = $bc.ConvertFromString("#64748B")
        $TxtSessionLabel.Foreground = $bc.ConvertFromString("#64748B")
        $TxtTodayLabel.Foreground = $bc.ConvertFromString("#64748B")
        $TxtApptLabel.Foreground = $bc.ConvertFromString("#94A3B8")
        $TxtSessionDigits.Foreground = $bc.ConvertFromString("#38BDF8")
        $TxtTodayDigits.Foreground = $bc.ConvertFromString("#4ADE80")
    } elseif ($themeName -eq "light") {
        $BtnTheme.Content = "Theme: Light"
        $MainBorder.Background = $bc.ConvertFromString("#F8FAFC")
        $MainBorder.BorderBrush = $bc.ConvertFromString("#94A3B8")
        $MainBorder.BorderThickness = [System.Windows.Thickness]::new(1.5)
        $DigitsBorder.Background = $bc.ConvertFromString("#FFFFFF")
        $DigitsBorder.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        $DigitsDivider.Fill = $bc.ConvertFromString("#E2E8F0")
        $ApptBorder.Background = $bc.ConvertFromString("#FFFFFF")
        $ApptBorder.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        $TxtClock.Foreground = $bc.ConvertFromString("#475569")
        $TxtSessionLabel.Foreground = $bc.ConvertFromString("#64748B")
        $TxtTodayLabel.Foreground = $bc.ConvertFromString("#64748B")
        $TxtApptLabel.Foreground = $bc.ConvertFromString("#475569")
        $TxtSessionDigits.Foreground = $bc.ConvertFromString("#0284C7")
        $TxtTodayDigits.Foreground = $bc.ConvertFromString("#16A34A")
    } elseif ($themeName -eq "highvis") {
        $BtnTheme.Content = "Theme: High-Vis"
        $MainBorder.Background = $bc.ConvertFromString("#000000")
        $MainBorder.BorderBrush = $bc.ConvertFromString("#FFFF00")
        $MainBorder.BorderThickness = [System.Windows.Thickness]::new(2.5)
        $DigitsBorder.Background = $bc.ConvertFromString("#000000")
        $DigitsBorder.BorderBrush = $bc.ConvertFromString("#FFFF00")
        $DigitsDivider.Fill = $bc.ConvertFromString("#FFFF00")
        $ApptBorder.Background = $bc.ConvertFromString("#000000")
        $ApptBorder.BorderBrush = $bc.ConvertFromString("#FFFF00")
        $TxtClock.Foreground = $bc.ConvertFromString("#FFFF00")
        $TxtSessionLabel.Foreground = $bc.ConvertFromString("#FFFF00")
        $TxtTodayLabel.Foreground = $bc.ConvertFromString("#FFFF00")
        $TxtApptLabel.Foreground = $bc.ConvertFromString("#FFFF00")
        $TxtSessionDigits.Foreground = $bc.ConvertFromString("#00FFFF")
        $TxtTodayDigits.Foreground = $bc.ConvertFromString("#00FF00")
    }
    Refresh-ActivityButtonStyles

    if ($script:cbManagerWindow -and $script:cbManagerWindow.IsLoaded) {
        if (Get-Command "Apply-CallbackManagerTheme" -ErrorAction SilentlyContinue) {
            Apply-CallbackManagerTheme $script:cbManagerWindow $themeName
        }
        if ($script:RenderCallbackCardsAction) {
            & $script:RenderCallbackCardsAction
        }
    }
    Save-SessionState
}

$BtnTheme.Add_Click({
    $script:themeIndex = ($script:themeIndex + 1) % $script:themes.Count
    Apply-Theme $script:themes[$script:themeIndex]
})

# Refresh button styling based on current activity and palette
function Refresh-ActivityButtonStyles {
    $bc = [System.Windows.Media.BrushConverter]::new()
    $cur = $script:state.CurrentActivity

    foreach ($k in $activityButtons.Keys) {
        $btn = $activityButtons[$k]
        $pal = $activityPalette[$k]

        if ($k -eq $cur) {
            $btn.Background = $bc.ConvertFromString($pal.ActiveBg)
            $btn.Foreground = $bc.ConvertFromString("#FFFFFF")
            $btn.BorderBrush = $bc.ConvertFromString("#FFFFFF")
            $btn.FontWeight = [System.Windows.FontWeights]::Bold
        } else {
            $btn.Background = $bc.ConvertFromString($pal.InactiveBg)
            $btn.Foreground = $bc.ConvertFromString($pal.InactiveFg)
            $btn.BorderBrush = $bc.ConvertFromString($pal.Border)
            $btn.FontWeight = [System.Windows.FontWeights]::SemiBold
        }
    }
}

# Time calculation helpers
function Get-NowEpochMs {
    return [Math]::Floor([double](Get-Date -UFormat %s) * 1000)
}

function Accumulate-ActiveTime($now) {
    if ($script:state.Status -eq "RUNNING" -and $script:state.StartTime -gt 0) {
        $lastSwitch = $script:state.LastActivitySwitchTime
        if ($lastSwitch -le 0) { $lastSwitch = $script:state.StartTime }
        $elapsedSec = [Math]::Max(0, [Math]::Floor(($now - $lastSwitch) / 1000))
        # Guard against invalid huge intervals (cap at 24 hours)
        if ($elapsedSec -gt 0 -and $elapsedSec -le 86400) {
            $cur = $script:state.CurrentActivity
            if (!$script:state.ActivityMap.ContainsKey($cur)) { $script:state.ActivityMap[$cur] = 0 }
            $script:state.ActivityMap[$cur] += $elapsedSec
        }
    }
    $script:state.LastActivitySwitchTime = $now
}

# Activity button switching (captures every tap and accumulates time)
function Set-ActiveActivity($actKey) {
    $now = Get-NowEpochMs
    Accumulate-ActiveTime $now
    $script:state.CurrentActivity = $actKey

    # Increment tap event count
    if ($script:state.EventCounts.ContainsKey($actKey)) {
        $script:state.EventCounts[$actKey]++
    }

    # Log timestamp of this event
    $timestamp = (Get-Date).ToString("hh:mm tt")
    $script:state.Events += [pscustomobject]@{
        time = $timestamp
        activity = $actKey
    }

    Refresh-ActivityButtonStyles
    Save-SessionState
}

$BtnActInbound.Add_Click({ Set-ActiveActivity "inbound_call" })
$BtnActOutbound.Add_Click({ Set-ActiveActivity "outbound_call" })
$BtnActText.Add_Click({ Set-ActiveActivity "text_sms" })
$BtnActEmail.Add_Click({ Set-ActiveActivity "email_in" })
$BtnActAdmin.Add_Click({ Set-ActiveActivity "off_phone_work" })
$BtnActCallbacks.Add_Click({ Show-CallbackManager })

function Export-LocalDataJs {
    try {
        $shiftsJson = "[]"
        if (Test-Path $script:dataFile) {
            $raw = Get-Content $script:dataFile -Raw
            if ($raw -and $raw.Trim().Length -gt 0) {
                $parsed = $raw | ConvertFrom-Json
                $shiftsJson = @($parsed) | ConvertTo-Json -Depth 5
            }
        }
        $cbsJson = "[]"
        if (Test-Path $script:callbacksFile) {
            $rawCb = Get-Content $script:callbacksFile -Raw
            if ($rawCb -and $rawCb.Trim().Length -gt 0) {
                $parsedCb = $rawCb | ConvertFrom-Json
                $cbsJson = @($parsedCb) | ConvertTo-Json -Depth 5
            }
        }
        $callsJson = "[]"
        if (Test-Path $script:callsFile) {
            $rawCalls = Get-Content $script:callsFile -Raw
            if ($rawCalls -and $rawCalls.Trim().Length -gt 0) {
                $parsedCalls = $rawCalls | ConvertFrom-Json
                $callsJson = @($parsedCalls) | ConvertTo-Json -Depth 5
            }
        }
        $salesRepsJson = "[]"
        if (Test-Path $script:salesRepsFile) {
            $rawReps = Get-Content $script:salesRepsFile -Raw
            if ($rawReps -and $rawReps.Trim().Length -gt 0) {
                $parsedReps = $rawReps | ConvertFrom-Json
                $salesRepsJson = @($parsedReps) | ConvertTo-Json -Depth 3
            }
        } else {
            $salesRepsJson = @($script:defaultSalesReps) | ConvertTo-Json -Depth 3
        }
        $snaps = @()
        if (Test-Path $script:historyDir) {
            $snapFiles = Get-ChildItem -Path $script:historyDir -Filter "snapshot_*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 12
            foreach ($sf in $snapFiles) {
                try {
                    $sd = Get-Content $sf.FullName -Raw | ConvertFrom-Json
                    $snaps += [pscustomobject]@{
                        file = $sf.Name
                        time = $sd.dateStr
                        timestamp = $sd.timestamp
                        shiftsCount = if ($sd.shifts) { @($sd.shifts).Count } else { 0 }
                        cbsCount = if ($sd.callbacks) { @($sd.callbacks).Count } else { 0 }
                        callsCount = if ($sd.calls) { @($sd.calls).Count } else { 0 }
                    }
                } catch {}
            }
        }
        $snapsJson = if ($snaps.Count -gt 0) { $snaps | ConvertTo-Json -Depth 3 } else { "[]" }
        $sessionJson = $script:state | ConvertTo-Json -Depth 4
        $themeStr = if ($script:state.Theme) { $script:state.Theme } else { "dark" }
        $jsContent = "window.SABRINA_LOCAL_DATA = { version: `"$($script:appVersion)`", build: `"$($script:appBuild)`", shifts: $shiftsJson, activeSession: $sessionJson, callbacks: $cbsJson, calls: $callsJson, salesReps: $salesRepsJson, history: $snapsJson, theme: `"$themeStr`" };"
        $jsPath = Join-Path $script:dataDir "shifts_data.js"
        Set-Content -Path $jsPath -Value $jsContent -Force
    } catch {}
}

function Save-5MinSnapshot {
    try {
        $nowStr = (Get-Date).ToString("yyyyMMdd_HHmm")
        $snapFile = Join-Path $script:historyDir "snapshot_$nowStr.json"
        
        $shifts = if (Test-Path $script:dataFile) { Get-Content $script:dataFile -Raw | ConvertFrom-Json } else { @() }
        $cbs = if (Test-Path $script:callbacksFile) { Get-Content $script:callbacksFile -Raw | ConvertFrom-Json } else { @() }
        $calls = if (Test-Path $script:callsFile) { Get-Content $script:callsFile -Raw | ConvertFrom-Json } else { @() }
        $reps = Get-SalesRepsList

        $snapData = [pscustomobject]@{
            timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            dateStr = (Get-Date).ToString("yyyy-MM-dd hh:mm tt")
            version = $script:appVersion
            shifts = $shifts
            callbacks = $cbs
            calls = $calls
            salesReps = $reps
        }
        $snapData | ConvertTo-Json -Depth 5 | Set-Content -Path $snapFile -Force

        # Prune old snapshots - keep most recent 24 (past 2 hours)
        $allSnaps = Get-ChildItem -Path $script:historyDir -Filter "snapshot_*.json" | Sort-Object LastWriteTime -Descending
        if ($allSnaps.Count -gt 24) {
            $allSnaps | Select-Object -Skip 24 | Remove-Item -Force -ErrorAction SilentlyContinue
        }
        Export-LocalDataJs
    } catch {}
}

function Get-SalesRepsList {
    if (Test-Path $script:salesRepsFile) {
        try {
            $raw = Get-Content $script:salesRepsFile -Raw
            if ($raw -and $raw.Trim().Length -gt 0) {
                $parsed = $raw | ConvertFrom-Json
                if ($parsed) { return @($parsed) }
            }
        } catch {}
    }
    try {
        @($script:defaultSalesReps) | ConvertTo-Json | Set-Content -Path $script:salesRepsFile -Force
    } catch {}
    return @($script:defaultSalesReps)
}

function Save-SalesRepsList($reps) {
    try {
        @($reps) | ConvertTo-Json | Set-Content -Path $script:salesRepsFile -Force
        Export-LocalDataJs
    } catch {}
}

function Get-CallsList {
    if (Test-Path $script:callsFile) {
        try {
            $raw = Get-Content $script:callsFile -Raw
            if ($raw -and $raw.Trim().Length -gt 0) {
                $parsed = $raw | ConvertFrom-Json
                if ($parsed) { return @($parsed) }
            }
        } catch {}
    }
    return @()
}

function Save-CallsList($calls) {
    try {
        $callsArray = @($calls)
        $callsArray | ConvertTo-Json -Depth 5 | Set-Content -Path $script:callsFile -Force
        Export-LocalDataJs
    } catch {}
}

function Get-CallbacksList {
    if (Test-Path $script:callbacksFile) {
        try {
            $raw = Get-Content $script:callbacksFile -Raw
            if ($raw -and $raw.Trim().Length -gt 0) {
                $parsed = $raw | ConvertFrom-Json
                if ($parsed) { return @($parsed) }
            }
        } catch {}
    }
    return @()
}

function Save-CallbacksList($cbs) {
    try {
        $cbsArray = @($cbs)
        $cbsArray | ConvertTo-Json -Depth 5 | Set-Content -Path $script:callbacksFile -Force
        Export-LocalDataJs
    } catch {}
}

function Get-PendingDueCallbacks {
    $nowEpoch = Get-NowEpochMs
    $todayStr = (Get-Date).ToString("yyyy-MM-dd")
    $all = Get-CallbacksList
    $due = @()
    foreach ($c in $all) {
        if ($c.status -eq "PENDING") {
            if (($c.dueEpoch -gt 0 -and $c.dueEpoch -le $nowEpoch) -or ($c.callbackDate -lt $todayStr)) {
                $due += $c
            }
        }
    }
    return $due
}

function Get-TodayPendingCallbacksCount {
    $all = Get-CallbacksList
    $count = 0
    foreach ($c in $all) {
        if ($c.status -eq "PENDING") {
            $count++
        }
    }
    return $count
}

function Add-CallbackItem($name, $phone, $email, $date, $time, $notes) {
    $nowMs = Get-NowEpochMs
    $dueEpoch = 0
    try {
        $combinedStr = "$date $time"
        $parsedDt = [DateTime]::Parse($combinedStr)
        $dueEpoch = [Math]::Floor([double](Get-Date $parsedDt -UFormat %s) * 1000)
    } catch {
        $dueEpoch = $nowMs
    }

    $newCb = [pscustomobject]@{
        id = "cb_" + $nowMs
        contactName = $name
        phone = $phone
        email = $email
        callbackDate = $date
        callbackTime = $time
        dueEpoch = $dueEpoch
        notes = $notes
        status = "PENDING"
        alerted = $false
        createdAt = $nowMs
        completedAt = $null
    }

    $all = @($newCb) + @(Get-CallbacksList)
    Save-CallbacksList $all
    return $newCb
}

function Complete-Callback($cbId) {
    $all = Get-CallbacksList
    foreach ($c in $all) {
        if ($c.id -eq $cbId) {
            $c.status = "COMPLETED"
            $c.completedAt = Get-NowEpochMs
            break
        }
    }
    Save-CallbacksList $all
}

function Snooze-Callback($cbId, $minutes) {
    $nowMs = Get-NowEpochMs
    $newDue = $nowMs + ($minutes * 60 * 1000)
    $newTimeStr = (Get-Date).AddMinutes($minutes).ToString("hh:mm tt")
    $all = Get-CallbacksList
    foreach ($c in $all) {
        if ($c.id -eq $cbId) {
            $c.dueEpoch = $newDue
            $c.callbackTime = $newTimeStr
            $c.alerted = $false
            $c.status = "PENDING"
            break
        }
    }
    Save-CallbacksList $all
}

function Delete-Callback($cbId) {
    $all = Get-CallbacksList
    $filtered = @()
    foreach ($c in $all) {
        if ($c.id -ne $cbId) {
            $filtered += $c
        }
    }
    Save-CallbacksList $filtered
}

function Show-CallbackToast($cb) {
    try {
        [System.Media.SystemSounds]::Exclamation.Play()
    } catch {}

    [xml]$toastXaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Callback Reminder"
        Width="380" Height="210"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        WindowStartupLocation="CenterScreen">
    <Border Name="ToastBorder" Background="#0F172A" BorderBrush="#EF4444" BorderThickness="2" CornerRadius="8" Padding="12">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="*"/>
                <RowDefinition Height="Auto"/>
            </Grid.RowDefinitions>

            <StackPanel Grid.Row="0" Orientation="Horizontal" Margin="0,0,0,8">
                <TextBlock Name="TxtToastHeader" Text="REMINDER: CALLBACK DUE NOW!" Foreground="#EF4444" FontWeight="Bold" FontSize="12"/>
            </StackPanel>

            <StackPanel Grid.Row="1" Margin="0,0,0,8">
                <TextBlock Name="TxtToastName" Foreground="#F8FAFC" FontWeight="Bold" FontSize="14" Margin="0,0,0,2"/>
                <TextBlock Name="TxtToastPhone" Foreground="#38BDF8" FontWeight="Bold" FontSize="13" Margin="0,0,0,2"/>
                <TextBlock Name="TxtToastNotes" Foreground="#CBD5E1" FontSize="11" TextWrapping="Wrap" MaxHeight="55"/>
            </StackPanel>

            <Grid Grid.Row="2">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                </Grid.ColumnDefinitions>
                <Button Name="BtnToastCopy" Grid.Column="0" Content="Copy Phone" Background="#0284C7" Foreground="White" FontWeight="Bold" FontSize="10" Padding="4,6" Margin="0,0,3,0" Cursor="Hand"/>
                <Button Name="BtnToastSnooze" Grid.Column="1" Content="Snooze 15m" Background="#D97706" Foreground="White" FontWeight="Bold" FontSize="10" Padding="4,6" Margin="0,0,3,0" Cursor="Hand"/>
                <Button Name="BtnToastDone" Grid.Column="2" Content="Mark Done" Background="#16A34A" Foreground="White" FontWeight="Bold" FontSize="10" Padding="4,6" Cursor="Hand"/>
            </Grid>
        </Grid>
    </Border>
</Window>
"@
    $reader = (New-Object System.Xml.XmlNodeReader $toastXaml)
    $toastWin = [System.Windows.Markup.XamlReader]::Load($reader)

    $curTheme = $script:state.Theme
    $bc = [System.Windows.Media.BrushConverter]::new()
    $border = $toastWin.FindName("ToastBorder")
    $name = $toastWin.FindName("TxtToastName")
    $phone = $toastWin.FindName("TxtToastPhone")
    $notes = $toastWin.FindName("TxtToastNotes")

    if ($curTheme -eq "light") {
        $border.Background = $bc.ConvertFromString("#FFFFFF")
        $border.BorderBrush = $bc.ConvertFromString("#EF4444")
        $name.Foreground = $bc.ConvertFromString("#0F172A")
        $phone.Foreground = $bc.ConvertFromString("#0284C7")
        $notes.Foreground = $bc.ConvertFromString("#475569")
    } elseif ($curTheme -eq "highvis") {
        $border.Background = $bc.ConvertFromString("#000000")
        $border.BorderBrush = $bc.ConvertFromString("#FF0000")
        $border.BorderThickness = [System.Windows.Thickness]::new(2.5)
        $name.Foreground = $bc.ConvertFromString("#FFFF00")
        $phone.Foreground = $bc.ConvertFromString("#00FFFF")
        $notes.Foreground = $bc.ConvertFromString("#FFFFFF")
    }

    $toastWin.FindName("TxtToastName").Text = [string]$cb.contactName
    $toastWin.FindName("TxtToastPhone").Text = "Phone: " + [string]$cb.phone
    $toastWin.FindName("TxtToastNotes").Text = "Notes: " + [string]$cb.notes

    $currPhone = [string]$cb.phone
    $currId = [string]$cb.id

    $toastWin.FindName("BtnToastCopy").Add_Click({
        [System.Windows.Clipboard]::SetText($currPhone)
        Show-CallbackManager
        $toastWin.Close()
    }.GetNewClosure())

    $toastWin.FindName("BtnToastSnooze").Add_Click({
        Snooze-Callback $currId 15
        $toastWin.Close()
    }.GetNewClosure())

    $toastWin.FindName("BtnToastDone").Add_Click({
        Complete-Callback $currId
        $toastWin.Close()
    }.GetNewClosure())

    $toastWin.Show()
}

function Adjust-TimeString([string]$currentTimeStr, [int]$deltaMinutes) {
    try {
        $parsed = $null
        $formats = @("h:mm tt", "hh:mm tt", "h:mmtt", "hh:mmtt", "H:mm", "HH:mm")
        if ([DateTime]::TryParseExact($currentTimeStr.Trim(), $formats, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$parsed)) {
            return $parsed.AddMinutes($deltaMinutes).ToString("hh:mm tt")
        }
        if ([DateTime]::TryParse($currentTimeStr.Trim(), [ref]$parsed)) {
            return $parsed.AddMinutes($deltaMinutes).ToString("hh:mm tt")
        }
    } catch {}
    return (Get-Date).AddMinutes($deltaMinutes).ToString("hh:mm tt")
}

function Apply-QuickApptModalTheme($apptWin, $themeName) {
    if (!$apptWin) { return }
    $bc = [System.Windows.Media.BrushConverter]::new()
    $border = $apptWin.FindName("ApptModalBorder")
    $title = $apptWin.FindName("TxtApptTitle")
    $btnClose = $apptWin.FindName("BtnApptClose")
    $lblCust = $apptWin.FindName("LblApptCust")
    $lblPhone = $apptWin.FindName("LblApptPhone")
    $tbName = $apptWin.FindName("TbQuickName")
    $tbPhone = $apptWin.FindName("TbQuickPhone")
    $lblApptDate = $apptWin.FindName("LblApptDate")
    $lblApptTime = $apptWin.FindName("LblApptTime")
    $tbApptDate = $apptWin.FindName("TbApptDate")
    $tbApptTime = $apptWin.FindName("TbApptTime")
    $lblApptRep = $apptWin.FindName("LblApptRep")
    $cbApptRep = $apptWin.FindName("CbApptRep")
    $chkCb = $apptWin.FindName("ChkQuickCallback")
    $borderCbTime = $apptWin.FindName("BorderCbTime")
    $lblCbDate = $apptWin.FindName("LblCbDate")
    $lblCbTime = $apptWin.FindName("LblCbTime")
    $tbQuickDate = $apptWin.FindName("TbQuickDate")
    $tbQuickTime = $apptWin.FindName("TbQuickTime")
    $stepperNames = @("BtnCbM1h", "BtnCbM30m", "BtnCbM15m", "BtnCbM10m", "BtnCbM5m", "BtnCbP5m", "BtnCbP10m", "BtnCbP15m", "BtnCbP30m", "BtnCbP1h", "BtnCbToday", "BtnCbTom")
    $quickBtns = @()
    foreach ($sn in $stepperNames) {
        $btn = $apptWin.FindName($sn)
        if ($btn) { $quickBtns += $btn }
    }
    $btnSave = $apptWin.FindName("BtnQuickSave")
    $btnSkip = $apptWin.FindName("BtnQuickSkip")

    if ($themeName -eq "light") {
        if ($border) {
            $border.Background = $bc.ConvertFromString("#FFFFFF")
            $border.BorderBrush = $bc.ConvertFromString("#16A34A")
            $border.BorderThickness = [System.Windows.Thickness]::new(1.5)
        }
        if ($title) { $title.Foreground = $bc.ConvertFromString("#15803D") }
        if ($btnClose) {
            $btnClose.Background = $bc.ConvertFromString("#E2E8F0")
            $btnClose.Foreground = $bc.ConvertFromString("#475569")
        }
        foreach ($l in @($lblCust, $lblPhone, $lblApptDate, $lblApptTime, $lblApptRep, $lblCbDate, $lblCbTime)) {
            if ($l) { $l.Foreground = $bc.ConvertFromString("#475569") }
        }
        if ($tbName) {
            $tbName.Background = $bc.ConvertFromString("#F1F5F9")
            $tbName.Foreground = $bc.ConvertFromString("#0F172A")
            $tbName.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($tbPhone) {
            $tbPhone.Background = $bc.ConvertFromString("#F1F5F9")
            $tbPhone.Foreground = $bc.ConvertFromString("#0284C7")
            $tbPhone.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($tbApptDate) {
            $tbApptDate.Background = $bc.ConvertFromString("#F1F5F9")
            $tbApptDate.Foreground = $bc.ConvertFromString("#0F172A")
            $tbApptDate.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($tbApptTime) {
            $tbApptTime.Background = $bc.ConvertFromString("#F1F5F9")
            $tbApptTime.Foreground = $bc.ConvertFromString("#15803D")
            $tbApptTime.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($cbApptRep) {
            $cbApptRep.Background = $bc.ConvertFromString("#F1F5F9")
            $cbApptRep.Foreground = $bc.ConvertFromString("#0F172A")
            $cbApptRep.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($chkCb) { $chkCb.Foreground = $bc.ConvertFromString("#15803D") }
        if ($borderCbTime) {
            $borderCbTime.Background = $bc.ConvertFromString("#F8FAFC")
            $borderCbTime.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($tbQuickDate) {
            $tbQuickDate.Background = $bc.ConvertFromString("#FFFFFF")
            $tbQuickDate.Foreground = $bc.ConvertFromString("#0F172A")
            $tbQuickDate.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($tbQuickTime) {
            $tbQuickTime.Background = $bc.ConvertFromString("#FFFFFF")
            $tbQuickTime.Foreground = $bc.ConvertFromString("#15803D")
            $tbQuickTime.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        foreach ($qb in $quickBtns) {
            if ($qb) {
                $qb.Background = $bc.ConvertFromString("#E2E8F0")
                $qb.Foreground = $bc.ConvertFromString("#334155")
            }
        }
        if ($btnSave) {
            $btnSave.Background = $bc.ConvertFromString("#16A34A")
            $btnSave.Foreground = $bc.ConvertFromString("#FFFFFF")
        }
        if ($btnSkip) {
            $btnSkip.Background = $bc.ConvertFromString("#E2E8F0")
            $btnSkip.Foreground = $bc.ConvertFromString("#334155")
        }
    } elseif ($themeName -eq "highvis") {
        if ($border) {
            $border.Background = $bc.ConvertFromString("#000000")
            $border.BorderBrush = $bc.ConvertFromString("#FFFF00")
            $border.BorderThickness = [System.Windows.Thickness]::new(2.5)
        }
        if ($title) { $title.Foreground = $bc.ConvertFromString("#FFFF00") }
        if ($btnClose) {
            $btnClose.Background = $bc.ConvertFromString("#000000")
            $btnClose.Foreground = $bc.ConvertFromString("#FFFF00")
            $btnClose.BorderBrush = $bc.ConvertFromString("#FFFF00")
            $btnClose.BorderThickness = [System.Windows.Thickness]::new(1)
        }
        foreach ($l in @($lblCust, $lblPhone, $lblApptDate, $lblApptTime, $lblApptRep, $lblCbDate, $lblCbTime)) {
            if ($l) { $l.Foreground = $bc.ConvertFromString("#FFFF00") }
        }
        if ($tbName) {
            $tbName.Background = $bc.ConvertFromString("#000000")
            $tbName.Foreground = $bc.ConvertFromString("#FFFF00")
            $tbName.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($tbPhone) {
            $tbPhone.Background = $bc.ConvertFromString("#000000")
            $tbPhone.Foreground = $bc.ConvertFromString("#00FFFF")
            $tbPhone.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($tbApptDate) {
            $tbApptDate.Background = $bc.ConvertFromString("#000000")
            $tbApptDate.Foreground = $bc.ConvertFromString("#FFFF00")
            $tbApptDate.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($tbApptTime) {
            $tbApptTime.Background = $bc.ConvertFromString("#000000")
            $tbApptTime.Foreground = $bc.ConvertFromString("#00FF00")
            $tbApptTime.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($cbApptRep) {
            $cbApptRep.Background = $bc.ConvertFromString("#000000")
            $cbApptRep.Foreground = $bc.ConvertFromString("#FFFF00")
            $cbApptRep.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($chkCb) { $chkCb.Foreground = $bc.ConvertFromString("#FFFF00") }
        if ($borderCbTime) {
            $borderCbTime.Background = $bc.ConvertFromString("#000000")
            $borderCbTime.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($tbQuickDate) {
            $tbQuickDate.Background = $bc.ConvertFromString("#000000")
            $tbQuickDate.Foreground = $bc.ConvertFromString("#FFFF00")
            $tbQuickDate.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($tbQuickTime) {
            $tbQuickTime.Background = $bc.ConvertFromString("#000000")
            $tbQuickTime.Foreground = $bc.ConvertFromString("#FFFF00")
            $tbQuickTime.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        foreach ($qb in $quickBtns) {
            if ($qb) {
                $qb.Background = $bc.ConvertFromString("#000000")
                $qb.Foreground = $bc.ConvertFromString("#FFFF00")
                $qb.BorderBrush = $bc.ConvertFromString("#FFFF00")
                $qb.BorderThickness = [System.Windows.Thickness]::new(1)
            }
        }
        if ($btnSave) {
            $btnSave.Background = $bc.ConvertFromString("#00FF00")
            $btnSave.Foreground = $bc.ConvertFromString("#000000")
        }
        if ($btnSkip) {
            $btnSkip.Background = $bc.ConvertFromString("#000000")
            $btnSkip.Foreground = $bc.ConvertFromString("#FFFF00")
            $btnSkip.BorderBrush = $bc.ConvertFromString("#FFFF00")
            $btnSkip.BorderThickness = [System.Windows.Thickness]::new(1)
        }
    } else {
        # Dark
        if ($border) {
            $border.Background = $bc.ConvertFromString("#0F172A")
            $border.BorderBrush = $bc.ConvertFromString("#22C55E")
            $border.BorderThickness = [System.Windows.Thickness]::new(2)
        }
        if ($title) { $title.Foreground = $bc.ConvertFromString("#22C55E") }
        if ($btnClose) {
            $btnClose.Background = $bc.ConvertFromString("#334155")
            $btnClose.Foreground = $bc.ConvertFromString("#FFFFFF")
        }
        foreach ($l in @($lblCust, $lblPhone, $lblApptDate, $lblApptTime, $lblApptRep, $lblCbDate, $lblCbTime)) {
            if ($l) { $l.Foreground = $bc.ConvertFromString("#94A3B8") }
        }
        if ($tbName) {
            $tbName.Background = $bc.ConvertFromString("#1E293B")
            $tbName.Foreground = $bc.ConvertFromString("#FFFFFF")
            $tbName.BorderBrush = $bc.ConvertFromString("#475569")
        }
        if ($tbPhone) {
            $tbPhone.Background = $bc.ConvertFromString("#1E293B")
            $tbPhone.Foreground = $bc.ConvertFromString("#38BDF8")
            $tbPhone.BorderBrush = $bc.ConvertFromString("#475569")
        }
        if ($tbApptDate) {
            $tbApptDate.Background = $bc.ConvertFromString("#1E293B")
            $tbApptDate.Foreground = $bc.ConvertFromString("#FFFFFF")
            $tbApptDate.BorderBrush = $bc.ConvertFromString("#475569")
        }
        if ($tbApptTime) {
            $tbApptTime.Background = $bc.ConvertFromString("#1E293B")
            $tbApptTime.Foreground = $bc.ConvertFromString("#4ADE80")
            $tbApptTime.BorderBrush = $bc.ConvertFromString("#475569")
        }
        if ($cbApptRep) {
            $cbApptRep.Background = $bc.ConvertFromString("#1E293B")
            $cbApptRep.Foreground = $bc.ConvertFromString("#FFFFFF")
            $cbApptRep.BorderBrush = $bc.ConvertFromString("#475569")
        }
        if ($chkCb) { $chkCb.Foreground = $bc.ConvertFromString("#FDE047") }
        if ($borderCbTime) {
            $borderCbTime.Background = $bc.ConvertFromString("#1E293B")
            $borderCbTime.BorderBrush = $bc.ConvertFromString("#334155")
        }
        if ($tbQuickDate) {
            $tbQuickDate.Background = $bc.ConvertFromString("#0F172A")
            $tbQuickDate.Foreground = $bc.ConvertFromString("#FFFFFF")
            $tbQuickDate.BorderBrush = $bc.ConvertFromString("#475569")
        }
        if ($tbQuickTime) {
            $tbQuickTime.Background = $bc.ConvertFromString("#0F172A")
            $tbQuickTime.Foreground = $bc.ConvertFromString("#FDE047")
            $tbQuickTime.BorderBrush = $bc.ConvertFromString("#475569")
        }
        foreach ($qb in $quickBtns) {
            if ($qb) {
                $qb.Background = $bc.ConvertFromString("#334155")
                $qb.Foreground = $bc.ConvertFromString("#CBD5E1")
            }
        }
        if ($btnSave) {
            $btnSave.Background = $bc.ConvertFromString("#22C55E")
            $btnSave.Foreground = $bc.ConvertFromString("#FFFFFF")
        }
        if ($btnSkip) {
            $btnSkip.Background = $bc.ConvertFromString("#334155")
            $btnSkip.Foreground = $bc.ConvertFromString("#CBD5E1")
        }
    }
}

function Show-QuickApptModal([switch]$NoShow) {
    [xml]$apptXaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Book Appointment"
        Width="440" Height="520"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        WindowStartupLocation="CenterScreen">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="4" Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>
    <Border Name="ApptModalBorder" Background="#0F172A" BorderBrush="#22C55E" BorderThickness="2" CornerRadius="10" Padding="14">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="*"/>
            </Grid.RowDefinitions>

            <Grid Grid.Row="0" Margin="0,0,0,10">
                <TextBlock Name="TxtApptTitle" Text="BOOK APPOINTMENT" Foreground="#22C55E" FontWeight="Bold" FontSize="13"/>
                <Button Name="BtnApptClose" Content="X" HorizontalAlignment="Right" Background="#334155" Foreground="White" FontWeight="Bold" FontSize="11" Width="20" Height="20" BorderThickness="0" Cursor="Hand"/>
            </Grid>

            <!-- Customer Name & Phone -->
            <Grid Grid.Row="1" Margin="0,0,0,8">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                </Grid.ColumnDefinitions>
                <StackPanel Grid.Column="0" Margin="0,0,5,0">
                    <TextBlock Name="LblApptCust" Text="Customer Name:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                    <TextBox Name="TbQuickName" Background="#1E293B" Foreground="White" BorderBrush="#475569" Padding="5,4" FontSize="12"/>
                </StackPanel>
                <StackPanel Grid.Column="1" Margin="5,0,0,0">
                    <TextBlock Name="LblApptPhone" Text="Phone Number:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                    <TextBox Name="TbQuickPhone" Background="#1E293B" Foreground="#38BDF8" FontWeight="Bold" BorderBrush="#475569" Padding="5,4" FontSize="12"/>
                </StackPanel>
            </Grid>

            <!-- Appointment Date, Time & Sales Rep -->
            <Grid Grid.Row="2" Margin="0,0,0,8">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="*"/>
                </Grid.ColumnDefinitions>
                <StackPanel Grid.Column="0" Margin="0,0,5,0">
                    <TextBlock Name="LblApptDate" Text="Appointment Date:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                    <TextBox Name="TbApptDate" Background="#1E293B" Foreground="White" BorderBrush="#475569" Padding="5,4" FontSize="11"/>
                </StackPanel>
                <StackPanel Grid.Column="1" Margin="5,0,0,0">
                    <TextBlock Name="LblApptTime" Text="Appointment Time:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                    <TextBox Name="TbApptTime" Background="#1E293B" Foreground="#4ADE80" FontWeight="Bold" BorderBrush="#475569" Padding="5,4" FontSize="11"/>
                </StackPanel>
            </Grid>

            <!-- Sales Rep Selection -->
            <StackPanel Grid.Row="3" Margin="0,0,0,10">
                <TextBlock Name="LblApptRep" Text="Assigned Sales Representative:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                <ComboBox Name="CbApptRep" Background="#1E293B" Foreground="White" BorderBrush="#475569" Padding="5,4" FontSize="11">
                </ComboBox>
            </StackPanel>

            <!-- Callback Reminder with Time, Date & Stepper Presets -->
            <StackPanel Grid.Row="4" Margin="0,0,0,10">
                <CheckBox Name="ChkQuickCallback" Content=" Schedule Callback Reminder" Foreground="#FDE047" FontWeight="Bold" FontSize="11" VerticalAlignment="Center" IsChecked="True" Margin="0,0,0,6"/>
                <Border Name="BorderCbTime" Background="#1E293B" BorderBrush="#334155" BorderThickness="1" CornerRadius="6" Padding="8,6">
                    <StackPanel>
                        <Grid Margin="0,0,0,5">
                            <Grid.ColumnDefinitions>
                                <ColumnDefinition Width="*"/>
                                <ColumnDefinition Width="*"/>
                            </Grid.ColumnDefinitions>
                            <StackPanel Grid.Column="0" Margin="0,0,4,0">
                                <TextBlock Name="LblCbDate" Text="Callback Date:" Foreground="#94A3B8" FontSize="9" Margin="0,0,0,2"/>
                                <TextBox Name="TbQuickDate" Background="#0F172A" Foreground="White" BorderBrush="#475569" Padding="4,2" FontSize="11"/>
                            </StackPanel>
                            <StackPanel Grid.Column="1" Margin="4,0,0,0">
                                <TextBlock Name="LblCbTime" Text="Callback Time:" Foreground="#94A3B8" FontSize="9" Margin="0,0,0,2"/>
                                <TextBox Name="TbQuickTime" Background="#0F172A" Foreground="#FDE047" FontWeight="Bold" BorderBrush="#475569" Padding="4,2" FontSize="11"/>
                            </StackPanel>
                        </Grid>

                        <!-- Minus Steppers Row -->
                        <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,0,0,3">
                            <TextBlock Text="Subtract: " Foreground="#64748B" FontSize="9" VerticalAlignment="Center" Margin="0,0,4,0"/>
                            <Button Name="BtnCbM1h" Content="-1h" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbM30m" Content="-30m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbM15m" Content="-15m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbM10m" Content="-10m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbM5m" Content="-5m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Cursor="Hand"/>
                        </StackPanel>

                        <!-- Plus Steppers Row -->
                        <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                            <TextBlock Text="Add: " Foreground="#64748B" FontSize="9" VerticalAlignment="Center" Margin="0,0,4,0"/>
                            <Button Name="BtnCbP5m" Content="+5m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbP10m" Content="+10m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbP15m" Content="+15m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbP30m" Content="+30m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbP1h" Content="+1h" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,4,0" Cursor="Hand"/>
                            <Button Name="BtnCbToday" Content="Today" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Margin="0,0,2,0" Cursor="Hand"/>
                            <Button Name="BtnCbTom" Content="Tom" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,1" Cursor="Hand"/>
                        </StackPanel>
                    </StackPanel>
                </Border>
            </StackPanel>

            <Grid Grid.Row="5" VerticalAlignment="Bottom">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <Button Name="BtnQuickSave" Grid.Column="0" Content="Book and Log Appt" Background="#22C55E" Foreground="White" FontWeight="Bold" FontSize="11" Padding="8,7" Margin="0,0,6,0" Cursor="Hand" IsDefault="True"/>
                <Button Name="BtnQuickSkip" Grid.Column="1" Content="Skip (+1 Only)" Background="#334155" Foreground="#CBD5E1" FontSize="10" Padding="8,7" Cursor="Hand" ToolTip="Quickly bump appointment counter by 1 without logging details"/>
            </Grid>
        </Grid>
    </Border>
</Window>
"@
    $reader = (New-Object System.Xml.XmlNodeReader $apptXaml)
    $apptWin = [System.Windows.Markup.XamlReader]::Load($reader)

    Apply-QuickApptModalTheme $apptWin $script:state.Theme

    $tbName = $apptWin.FindName("TbQuickName")
    $tbPhone = $apptWin.FindName("TbQuickPhone")
    $tbApptDate = $apptWin.FindName("TbApptDate")
    $tbApptTime = $apptWin.FindName("TbApptTime")
    $cbApptRep = $apptWin.FindName("CbApptRep")
    $chkCb = $apptWin.FindName("ChkQuickCallback")
    $borderCb = $apptWin.FindName("BorderCbTime")
    $tbDate = $apptWin.FindName("TbQuickDate")
    $tbTime = $apptWin.FindName("TbQuickTime")

    # Populate Sales Representatives from JSON
    $bcRep = [System.Windows.Media.BrushConverter]::new()
    $repsList = Get-SalesRepsList
    $cbApptRep.Items.Clear()
    foreach ($r in $repsList) {
        $cbi = New-Object System.Windows.Controls.ComboBoxItem
        $cbi.Content = $r
        if ($script:state.Theme -eq "light") {
            $cbi.Background = $bcRep.ConvertFromString("#FFFFFF")
            $cbi.Foreground = $bcRep.ConvertFromString("#0F172A")
        } elseif ($script:state.Theme -eq "highvis") {
            $cbi.Background = $bcRep.ConvertFromString("#000000")
            $cbi.Foreground = $bcRep.ConvertFromString("#FFFF00")
        } else {
            $cbi.Background = $bcRep.ConvertFromString("#1E293B")
            $cbi.Foreground = $bcRep.ConvertFromString("#FFFFFF")
        }
        $cbApptRep.Items.Add($cbi) | Out-Null
    }
    if ($cbApptRep.Items.Count -gt 0) { $cbApptRep.SelectedIndex = 0 }

    # Pre-populate appointment defaults
    $tbApptDate.Text = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
    $tbApptTime.Text = "10:00 AM"

    # Pre-populate callback defaults
    $tbDate.Text = (Get-Date).ToString("yyyy-MM-dd")
    $tbTime.Text = (Get-Date).AddHours(1).ToString("hh:mm tt")

    $chkCb.Add_Checked({
        $borderCb.Visibility = [System.Windows.Visibility]::Visible
    })
    $chkCb.Add_Unchecked({
        $borderCb.Visibility = [System.Windows.Visibility]::Collapsed
    })

    # Stepper buttons
    $apptWin.FindName("BtnCbM1h").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -60 })
    $apptWin.FindName("BtnCbM30m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -30 })
    $apptWin.FindName("BtnCbM15m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -15 })
    $apptWin.FindName("BtnCbM10m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -10 })
    $apptWin.FindName("BtnCbM5m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -5 })

    $apptWin.FindName("BtnCbP5m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 5 })
    $apptWin.FindName("BtnCbP10m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 10 })
    $apptWin.FindName("BtnCbP15m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 15 })
    $apptWin.FindName("BtnCbP30m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 30 })
    $apptWin.FindName("BtnCbP1h").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 60 })

    $apptWin.FindName("BtnCbToday").Add_Click({ $tbDate.Text = (Get-Date).ToString("yyyy-MM-dd") })
    $apptWin.FindName("BtnCbTom").Add_Click({ $tbDate.Text = (Get-Date).AddDays(1).ToString("yyyy-MM-dd") })

    $apptWin.Add_Loaded({
        $tbName.Focus()
    })

    $apptWin.FindName("BtnApptClose").Add_Click({
        $apptWin.Close()
    })

    $apptWin.FindName("BtnQuickSkip").Add_Click({
        $script:state.TodayAppts++
        $TxtAppts.Text = $script:state.TodayAppts.ToString()
        Save-SessionState
        Export-LocalDataJs
        $apptWin.Close()
    })

    $apptWin.FindName("BtnQuickSave").Add_Click({
        $script:state.TodayAppts++
        $TxtAppts.Text = $script:state.TodayAppts.ToString()

        $name = if ($tbName.Text.Trim()) { $tbName.Text.Trim() } else { "Customer" }
        $phone = $tbPhone.Text.Trim()
        $apptDateVal = if ($tbApptDate.Text.Trim()) { $tbApptDate.Text.Trim() } else { (Get-Date).AddDays(1).ToString("yyyy-MM-dd") }
        $apptTimeVal = if ($tbApptTime.Text.Trim()) { $tbApptTime.Text.Trim() } else { "10:00 AM" }
        $repVal = if ($cbApptRep.Text -and $cbApptRep.Text.Trim()) { $cbApptRep.Text.Trim() } elseif ($cbApptRep.SelectedItem) { $cbApptRep.SelectedItem.Content } else { "Representative 1" }

        # Auto-save newly typed rep into sales_reps.json if not in list
        $currentReps = Get-SalesRepsList
        if ($repVal -and -not ($currentReps -contains $repVal)) {
            $currentReps += $repVal
            Save-SalesRepsList $currentReps
        }

        $callItem = [pscustomobject]@{
            id = "call_" + (Get-Date).ToString("yyyyMMdd_HHmmss")
            contactName = $name
            phone = $phone
            type = "Appointment Booked"
            time = (Get-Date).ToString("hh:mm tt")
            date = (Get-Date).ToString("yyyy-MM-dd")
            apptDate = $apptDateVal
            apptTime = $apptTimeVal
            salesRep = $repVal
            outcome = "Appointment booked for $repVal on $apptDateVal at $apptTimeVal"
        }
        $existingCalls = Get-CallsList
        Save-CallsList (@($callItem) + @($existingCalls))

        if ($chkCb.IsChecked -eq $true) {
            $cbDate = if ($tbDate.Text.Trim()) { $tbDate.Text.Trim() } else { (Get-Date).ToString("yyyy-MM-dd") }
            $cbTime = if ($tbTime.Text.Trim()) { $tbTime.Text.Trim() } else { (Get-Date).AddHours(1).ToString("hh:mm tt") }
            Add-CallbackItem -name $name -phone $phone -email "" -date $cbDate -time $cbTime -notes "Appt follow-up with $repVal ($apptDateVal at $apptTimeVal)"
        }

        Save-SessionState
        Export-LocalDataJs
        $apptWin.Close()
    })

    if (!$NoShow) {
        $apptWin.ShowDialog() | Out-Null
    }
    return $apptWin
}

$script:cbManagerWindow = $null

function Apply-CallbackManagerFilterStyles($mgrWin, $themeName) {
    if (!$mgrWin) { return }
    $bc = [System.Windows.Media.BrushConverter]::new()
    $filters = @(
        @{ Name="BtnFilterAll"; Filter="all" },
        @{ Name="BtnFilterDue"; Filter="due" },
        @{ Name="BtnFilterPending"; Filter="pending" },
        @{ Name="BtnFilterDone"; Filter="done" }
    )
    foreach ($f in $filters) {
        $btn = $mgrWin.FindName($f.Name)
        if (!$btn) { continue }
        $isActive = ($script:currentFilter -eq $f.Filter)
        if ($themeName -eq "light") {
            if ($isActive) {
                $btn.Background = $bc.ConvertFromString("#2563EB")
                $btn.Foreground = $bc.ConvertFromString("#FFFFFF")
                $btn.BorderBrush = $bc.ConvertFromString("#1D4ED8")
            } else {
                $btn.Background = $bc.ConvertFromString("#F1F5F9")
                $btn.Foreground = $bc.ConvertFromString("#475569")
                $btn.BorderBrush = $bc.ConvertFromString("#CBD5E1")
            }
            $btn.BorderThickness = [System.Windows.Thickness]::new(1)
        } elseif ($themeName -eq "highvis") {
            if ($isActive) {
                $btn.Background = $bc.ConvertFromString("#FFFF00")
                $btn.Foreground = $bc.ConvertFromString("#000000")
                $btn.BorderBrush = $bc.ConvertFromString("#FFFF00")
            } else {
                $btn.Background = $bc.ConvertFromString("#000000")
                $btn.Foreground = $bc.ConvertFromString("#FFFF00")
                $btn.BorderBrush = $bc.ConvertFromString("#FFFF00")
            }
            $btn.BorderThickness = [System.Windows.Thickness]::new(1.5)
        } else {
            # Dark
            if ($isActive) {
                $btn.Background = $bc.ConvertFromString("#334155")
                $btn.Foreground = $bc.ConvertFromString("#FFFFFF")
                $btn.BorderBrush = $bc.ConvertFromString("#64748B")
            } else {
                $btn.Background = $bc.ConvertFromString("#1E293B")
                if ($f.Filter -eq "due") { $btn.Foreground = $bc.ConvertFromString("#FDE047") }
                elseif ($f.Filter -eq "pending") { $btn.Foreground = $bc.ConvertFromString("#93C5FD") }
                elseif ($f.Filter -eq "done") { $btn.Foreground = $bc.ConvertFromString("#4ADE80") }
                else { $btn.Foreground = $bc.ConvertFromString("#CBD5E1") }
                $btn.BorderBrush = $bc.ConvertFromString("#334155")
            }
            $btn.BorderThickness = [System.Windows.Thickness]::new(1)
        }
    }
}

function Apply-CallbackManagerTheme($mgrWin, $themeName) {
    if (!$mgrWin) { return }
    $bc = [System.Windows.Media.BrushConverter]::new()

    $outerBorder = $mgrWin.FindName("MgrOuterBorder")
    $title = $mgrWin.FindName("TxtMgrTitle")
    $btnClose = $mgrWin.FindName("BtnMgrClose")
    $btnCopyExcel = $mgrWin.FindName("BtnMgrCopyAllExcel")
    $addBorder = $mgrWin.FindName("MgrAddCardBorder")
    $addTitle = $mgrWin.FindName("TxtAddCardTitle")
    $listBorder = $mgrWin.FindName("MgrListBorder")
    $footer = $mgrWin.FindName("TxtMgrFooter")

    $labels = @("LblContactName", "LblPhone", "LblDate", "LblTime", "LblQuick", "LblNotes")
    $inputs = @("TbName", "TbPhone", "TbDate", "TbTime", "TbNotes")
    $quickBtns = @("BtnMgrToday", "BtnMgrTomorrow", "BtnMgrM1h", "BtnMgrM30m", "BtnMgrM15m", "BtnMgrM10m", "BtnMgrM5m", "BtnMgrP5m", "BtnMgrP10m", "BtnMgrP15m", "BtnMgrP30m", "BtnMgrP1h", "BtnQuickToday", "BtnQuickTomorrow", "BtnQuick15m", "BtnQuick1h")

    if ($themeName -eq "light") {
        if ($outerBorder) {
            $outerBorder.Background = $bc.ConvertFromString("#F8FAFC")
            $outerBorder.BorderBrush = $bc.ConvertFromString("#94A3B8")
            $outerBorder.BorderThickness = [System.Windows.Thickness]::new(1.5)
        }
        if ($title) { $title.Foreground = $bc.ConvertFromString("#0F172A") }
        if ($btnClose) {
            $btnClose.Background = $bc.ConvertFromString("#E2E8F0")
            $btnClose.Foreground = $bc.ConvertFromString("#475569")
        }
        if ($btnCopyExcel) {
            $btnCopyExcel.Background = $bc.ConvertFromString("#EFF6FF")
            $btnCopyExcel.Foreground = $bc.ConvertFromString("#1D4ED8")
            $btnCopyExcel.BorderBrush = $bc.ConvertFromString("#BFDBFE")
        }
        if ($addBorder) {
            $addBorder.Background = $bc.ConvertFromString("#FFFFFF")
            $addBorder.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($addTitle) { $addTitle.Foreground = $bc.ConvertFromString("#0284C7") }
        foreach ($l in $labels) {
            $ctrl = $mgrWin.FindName($l)
            if ($ctrl) { $ctrl.Foreground = $bc.ConvertFromString("#475569") }
        }
        foreach ($inp in $inputs) {
            $ctrl = $mgrWin.FindName($inp)
            if ($ctrl) {
                $ctrl.Background = $bc.ConvertFromString("#F1F5F9")
                $ctrl.BorderBrush = $bc.ConvertFromString("#CBD5E1")
                $ctrl.Foreground = if ($inp -eq "TbPhone") { $bc.ConvertFromString("#0284C7") } elseif ($inp -eq "TbTime") { $bc.ConvertFromString("#B45309") } else { $bc.ConvertFromString("#0F172A") }
            }
        }
        foreach ($qb in $quickBtns) {
            $ctrl = $mgrWin.FindName($qb)
            if ($ctrl) {
                $ctrl.Background = $bc.ConvertFromString("#E2E8F0")
                $ctrl.Foreground = $bc.ConvertFromString("#334155")
            }
        }
        if ($listBorder) {
            $listBorder.Background = $bc.ConvertFromString("#FFFFFF")
            $listBorder.BorderBrush = $bc.ConvertFromString("#CBD5E1")
        }
        if ($footer) { $footer.Foreground = $bc.ConvertFromString("#64748B") }
    } elseif ($themeName -eq "highvis") {
        if ($outerBorder) {
            $outerBorder.Background = $bc.ConvertFromString("#000000")
            $outerBorder.BorderBrush = $bc.ConvertFromString("#FFFF00")
            $outerBorder.BorderThickness = [System.Windows.Thickness]::new(2.5)
        }
        if ($title) { $title.Foreground = $bc.ConvertFromString("#FFFF00") }
        if ($btnClose) {
            $btnClose.Background = $bc.ConvertFromString("#000000")
            $btnClose.Foreground = $bc.ConvertFromString("#FFFF00")
            $btnClose.BorderBrush = $bc.ConvertFromString("#FFFF00")
            $btnClose.BorderThickness = [System.Windows.Thickness]::new(1)
        }
        if ($btnCopyExcel) {
            $btnCopyExcel.Background = $bc.ConvertFromString("#000000")
            $btnCopyExcel.Foreground = $bc.ConvertFromString("#00FFFF")
            $btnCopyExcel.BorderBrush = $bc.ConvertFromString("#00FFFF")
        }
        if ($addBorder) {
            $addBorder.Background = $bc.ConvertFromString("#000000")
            $addBorder.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($addTitle) { $addTitle.Foreground = $bc.ConvertFromString("#FFFF00") }
        foreach ($l in $labels) {
            $ctrl = $mgrWin.FindName($l)
            if ($ctrl) { $ctrl.Foreground = $bc.ConvertFromString("#FFFF00") }
        }
        foreach ($inp in $inputs) {
            $ctrl = $mgrWin.FindName($inp)
            if ($ctrl) {
                $ctrl.Background = $bc.ConvertFromString("#000000")
                $ctrl.BorderBrush = $bc.ConvertFromString("#FFFF00")
                $ctrl.Foreground = if ($inp -eq "TbPhone") { $bc.ConvertFromString("#00FFFF") } else { $bc.ConvertFromString("#FFFF00") }
            }
        }
        foreach ($qb in $quickBtns) {
            $ctrl = $mgrWin.FindName($qb)
            if ($ctrl) {
                $ctrl.Background = $bc.ConvertFromString("#000000")
                $ctrl.Foreground = $bc.ConvertFromString("#FFFF00")
                $ctrl.BorderBrush = $bc.ConvertFromString("#FFFF00")
                $ctrl.BorderThickness = [System.Windows.Thickness]::new(1)
            }
        }
        if ($listBorder) {
            $listBorder.Background = $bc.ConvertFromString("#000000")
            $listBorder.BorderBrush = $bc.ConvertFromString("#FFFF00")
        }
        if ($footer) { $footer.Foreground = $bc.ConvertFromString("#FFFF00") }
    } else {
        # Dark
        if ($outerBorder) {
            $outerBorder.Background = $bc.ConvertFromString("#0F172A")
            $outerBorder.BorderBrush = $bc.ConvertFromString("#334155")
            $outerBorder.BorderThickness = [System.Windows.Thickness]::new(2)
        }
        if ($title) { $title.Foreground = $bc.ConvertFromString("#F8FAFC") }
        if ($btnClose) {
            $btnClose.Background = $bc.ConvertFromString("#334155")
            $btnClose.Foreground = $bc.ConvertFromString("#FFFFFF")
        }
        if ($btnCopyExcel) {
            $btnCopyExcel.Background = $bc.ConvertFromString("#1E3A8A")
            $btnCopyExcel.Foreground = $bc.ConvertFromString("#93C5FD")
            $btnCopyExcel.BorderBrush = $bc.ConvertFromString("#2563EB")
        }
        if ($addBorder) {
            $addBorder.Background = $bc.ConvertFromString("#1E293B")
            $addBorder.BorderBrush = $bc.ConvertFromString("#334155")
        }
        if ($addTitle) { $addTitle.Foreground = $bc.ConvertFromString("#38BDF8") }
        foreach ($l in $labels) {
            $ctrl = $mgrWin.FindName($l)
            if ($ctrl) { $ctrl.Foreground = $bc.ConvertFromString("#94A3B8") }
        }
        foreach ($inp in $inputs) {
            $ctrl = $mgrWin.FindName($inp)
            if ($ctrl) {
                $ctrl.Background = $bc.ConvertFromString("#0F172A")
                $ctrl.BorderBrush = $bc.ConvertFromString("#475569")
                $ctrl.Foreground = if ($inp -eq "TbPhone") { $bc.ConvertFromString("#38BDF8") } elseif ($inp -eq "TbTime") { $bc.ConvertFromString("#FDE047") } else { $bc.ConvertFromString("#FFFFFF") }
            }
        }
        foreach ($qb in $quickBtns) {
            $ctrl = $mgrWin.FindName($qb)
            if ($ctrl) {
                $ctrl.Background = $bc.ConvertFromString("#334155")
                $ctrl.Foreground = $bc.ConvertFromString("#FFFFFF")
            }
        }
        if ($listBorder) {
            $listBorder.Background = $bc.ConvertFromString("#1E293B")
            $listBorder.BorderBrush = $bc.ConvertFromString("#334155")
        }
        if ($footer) { $footer.Foreground = $bc.ConvertFromString("#64748B") }
    }
    Apply-CallbackManagerFilterStyles $mgrWin $themeName
}

function Show-CallbackManager {
    if ($script:cbManagerWindow -and $script:cbManagerWindow.IsLoaded) {
        $script:cbManagerWindow.Activate()
        return
    }

    [xml]$mgrXaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Sabrina Callbacks and Leads"
        Width="720" Height="640"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        WindowStartupLocation="CenterScreen">
    <Window.Resources>
        <Style TargetType="Button">
            <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="Button">
                        <Border Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="4" Padding="{TemplateBinding Padding}">
                            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                        </Border>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>
    <Border Name="MgrOuterBorder" Background="#0F172A" BorderBrush="#334155" BorderThickness="2" CornerRadius="10" Padding="14">
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="*"/>
                <RowDefinition Height="Auto"/>
            </Grid.RowDefinitions>

            <!-- Header -->
            <Grid Grid.Row="0" Margin="0,0,0,10" Name="MgrHeaderBar" Background="Transparent" Cursor="SizeAll">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <StackPanel Grid.Column="0" Orientation="Horizontal" VerticalAlignment="Center">
                    <TextBlock Name="TxtMgrTitle" Text="Sabrina's Callback Reminders" Foreground="#F8FAFC" FontWeight="Bold" FontSize="14" Margin="0,0,10,0"/>
                    <TextBlock Name="TxtMgrStatus" Text="Ready" Foreground="#38BDF8" FontSize="11" VerticalAlignment="Center"/>
                </StackPanel>
                <StackPanel Grid.Column="1" Orientation="Horizontal">
                    <Button Name="BtnMgrCopyAllExcel" Content="Copy All for Excel" Background="#1E3A8A" Foreground="#93C5FD" FontWeight="Bold" FontSize="11" Padding="8,4" BorderThickness="1" BorderBrush="#2563EB" Margin="0,0,8,0" Cursor="Hand"/>
                    <Button Name="BtnMgrClose" Content="X" Background="#334155" Foreground="White" FontWeight="Bold" FontSize="12" Width="24" Height="24" BorderThickness="0" Cursor="Hand"/>
                </StackPanel>
            </Grid>

            <!-- Card: Add New Callback -->
            <Border Name="MgrAddCardBorder" Grid.Row="1" Background="#1E293B" BorderBrush="#334155" BorderThickness="1" CornerRadius="6" Padding="10" Margin="0,0,0,10">
                <Grid>
                    <Grid.RowDefinitions>
                        <RowDefinition Height="Auto"/>
                        <RowDefinition Height="Auto"/>
                        <RowDefinition Height="Auto"/>
                        <RowDefinition Height="Auto"/>
                    </Grid.RowDefinitions>

                    <TextBlock Name="TxtAddCardTitle" Grid.Row="0" Text="+ Add New Callback Reminder" Foreground="#38BDF8" FontWeight="Bold" FontSize="12" Margin="0,0,0,8"/>

                    <!-- Row 1: Name and Phone (Streamlined) -->
                    <Grid Grid.Row="1" Margin="0,0,0,6">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="*"/>
                        </Grid.ColumnDefinitions>
                        <StackPanel Grid.Column="0" Margin="0,0,6,0">
                            <TextBlock Name="LblContactName" Text="Contact Name:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                            <TextBox Name="TbName" Background="#0F172A" Foreground="White" BorderBrush="#475569" Padding="4" FontSize="11"/>
                        </StackPanel>
                        <StackPanel Grid.Column="1">
                            <TextBlock Name="LblPhone" Text="Phone Number:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                            <TextBox Name="TbPhone" Background="#0F172A" Foreground="#38BDF8" BorderBrush="#475569" FontWeight="Bold" Padding="4" FontSize="11"/>
                        </StackPanel>
                    </Grid>

                    <!-- Row 2: Date, Time, Quick steppers -->
                    <Grid Grid.Row="2" Margin="0,0,0,6">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="125"/>
                            <ColumnDefinition Width="105"/>
                            <ColumnDefinition Width="*"/>
                        </Grid.ColumnDefinitions>
                        <StackPanel Grid.Column="0" Margin="0,0,6,0">
                            <TextBlock Name="LblDate" Text="Date (YYYY-MM-DD):" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                            <TextBox Name="TbDate" Background="#0F172A" Foreground="White" BorderBrush="#475569" Padding="4" FontSize="11"/>
                        </StackPanel>
                        <StackPanel Grid.Column="1" Margin="0,0,6,0">
                            <TextBlock Name="LblTime" Text="Time:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                            <TextBox Name="TbTime" Background="#0F172A" Foreground="#FDE047" BorderBrush="#475569" FontWeight="Bold" Padding="4" FontSize="11"/>
                        </StackPanel>
                        <StackPanel Grid.Column="2" VerticalAlignment="Bottom">
                            <TextBlock Name="LblQuick" Text="Adjust Time (+/-):" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                            <WrapPanel Orientation="Horizontal">
                                <Button Name="BtnMgrToday" Content="Today" Background="#334155" Foreground="White" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrTomorrow" Content="Tom" Background="#334155" Foreground="White" FontSize="9" Padding="4,2" Margin="0,0,4,2" Cursor="Hand"/>
                                <Button Name="BtnMgrM1h" Content="-1h" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrM30m" Content="-30m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrM15m" Content="-15m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrM10m" Content="-10m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrM5m" Content="-5m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,4,2" Cursor="Hand"/>
                                <Button Name="BtnMgrP5m" Content="+5m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrP10m" Content="+10m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrP15m" Content="+15m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrP30m" Content="+30m" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                                <Button Name="BtnMgrP1h" Content="+1h" Background="#334155" Foreground="#CBD5E1" FontSize="9" Padding="4,2" Margin="0,0,2,2" Cursor="Hand"/>
                            </WrapPanel>
                        </StackPanel>
                    </Grid>

                    <!-- Row 3: Notes & Submit Button -->
                    <Grid Grid.Row="3">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="*"/>
                            <ColumnDefinition Width="Auto"/>
                        </Grid.ColumnDefinitions>
                        <StackPanel Grid.Column="0" Margin="0,0,8,0">
                            <TextBlock Name="LblNotes" Text="Notes / Customer Interest:" Foreground="#94A3B8" FontSize="10" Margin="0,0,0,2"/>
                            <TextBox Name="TbNotes" Background="#0F172A" Foreground="White" BorderBrush="#475569" Padding="4" FontSize="11"/>
                        </StackPanel>
                        <Button Name="BtnAddCallback" Grid.Column="1" Content="+ Add Callback" Background="#16A34A" Foreground="White" FontWeight="Bold" FontSize="12" Padding="14,0" BorderThickness="0" VerticalAlignment="Bottom" Height="28" Cursor="Hand"/>
                    </Grid>
                </Grid>
            </Border>

            <!-- Filters Bar -->
            <StackPanel Grid.Row="2" Orientation="Horizontal" Margin="0,0,0,8">
                <Button Name="BtnFilterAll" Content="All Callbacks" Background="#334155" Foreground="White" FontWeight="Bold" FontSize="10" Padding="8,3" Margin="0,0,5,0" Cursor="Hand"/>
                <Button Name="BtnFilterDue" Content="Due / Overdue" Background="#1E293B" Foreground="#FDE047" FontWeight="Bold" FontSize="10" Padding="8,3" Margin="0,0,5,0" Cursor="Hand"/>
                <Button Name="BtnFilterPending" Content="Upcoming" Background="#1E293B" Foreground="#93C5FD" FontWeight="Bold" FontSize="10" Padding="8,3" Margin="0,0,5,0" Cursor="Hand"/>
                <Button Name="BtnFilterDone" Content="Completed" Background="#1E293B" Foreground="#4ADE80" FontWeight="Bold" FontSize="10" Padding="8,3" Cursor="Hand"/>
            </StackPanel>

            <!-- Scrollable Callbacks List -->
            <Border Name="MgrListBorder" Grid.Row="3" Background="#1E293B" BorderBrush="#334155" BorderThickness="1" CornerRadius="6" Padding="6">
                <ScrollViewer VerticalScrollBarVisibility="Auto">
                    <StackPanel Name="CallbacksContainer"/>
                </ScrollViewer>
            </Border>

            <!-- Footer -->
            <TextBlock Name="TxtMgrFooter" Grid.Row="4" Text="Tip: Click 'Phone' to instantly copy the number for pasting into Telus softphone." Foreground="#64748B" FontSize="10" Margin="0,6,0,0"/>
        </Grid>
    </Border>
</Window>
"@

    $reader = (New-Object System.Xml.XmlNodeReader $mgrXaml)
    $script:cbManagerWindow = [System.Windows.Markup.XamlReader]::Load($reader)

    $mgrWin = $script:cbManagerWindow
    $mgrHeader = $mgrWin.FindName("MgrHeaderBar")
    $mgrHeader.Add_MouseLeftButtonDown({ $mgrWin.DragMove() })

    $txtStatus = $mgrWin.FindName("TxtMgrStatus")
    $tbName = $mgrWin.FindName("TbName")
    $tbPhone = $mgrWin.FindName("TbPhone")
    $tbDate = $mgrWin.FindName("TbDate")
    $tbTime = $mgrWin.FindName("TbTime")
    $tbNotes = $mgrWin.FindName("TbNotes")
    $container = $mgrWin.FindName("CallbacksContainer")

    # Set initial defaults
    $tbDate.Text = (Get-Date).ToString("yyyy-MM-dd")
    $tbTime.Text = (Get-Date).AddMinutes(30).ToString("hh:mm tt")

    # Quick set buttons
    $mgrWin.FindName("BtnMgrToday").Add_Click({ $tbDate.Text = (Get-Date).ToString("yyyy-MM-dd") })
    $mgrWin.FindName("BtnMgrTomorrow").Add_Click({ $tbDate.Text = (Get-Date).AddDays(1).ToString("yyyy-MM-dd") })

    $mgrWin.FindName("BtnMgrM1h").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -60 })
    $mgrWin.FindName("BtnMgrM30m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -30 })
    $mgrWin.FindName("BtnMgrM15m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -15 })
    $mgrWin.FindName("BtnMgrM10m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -10 })
    $mgrWin.FindName("BtnMgrM5m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text -5 })

    $mgrWin.FindName("BtnMgrP5m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 5 })
    $mgrWin.FindName("BtnMgrP10m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 10 })
    $mgrWin.FindName("BtnMgrP15m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 15 })
    $mgrWin.FindName("BtnMgrP30m").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 30 })
    $mgrWin.FindName("BtnMgrP1h").Add_Click({ $tbTime.Text = Adjust-TimeString $tbTime.Text 60 })

    # Close button
    $mgrWin.FindName("BtnMgrClose").Add_Click({ $mgrWin.Close() })

    # Filter state
    $script:currentFilter = "all"

    # Refresh items in container
    function Render-CallbackCards {
        $container.Children.Clear()
        $cbs = Get-CallbacksList
        $nowEpoch = Get-NowEpochMs
        $todayStr = (Get-Date).ToString("yyyy-MM-dd")

        $filtered = @()
        foreach ($c in $cbs) {
            $isDue = ($c.status -eq "PENDING") -and (($c.dueEpoch -gt 0 -and $c.dueEpoch -le $nowEpoch) -or ($c.callbackDate -lt $todayStr))
            if ($script:currentFilter -eq "all") {
                $filtered += $c
            } elseif ($script:currentFilter -eq "due" -and $isDue) {
                $filtered += $c
            } elseif ($script:currentFilter -eq "pending" -and $c.status -eq "PENDING" -and !$isDue) {
                $filtered += $c
            } elseif ($script:currentFilter -eq "done" -and $c.status -eq "COMPLETED") {
                $filtered += $c
            }
        }

        if ($filtered.Count -eq 0) {
            $emptyTb = New-Object System.Windows.Controls.TextBlock
            $emptyTb.Text = "No callbacks found in this view."
            $emptyTb.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#64748B")
            $emptyTb.Margin = [System.Windows.Thickness]::new(10)
            $emptyTb.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
            $container.Children.Add($emptyTb) | Out-Null
            return
        }

        foreach ($c in $filtered) {
            $isDue = ($c.status -eq "PENDING") -and (($c.dueEpoch -gt 0 -and $c.dueEpoch -le $nowEpoch) -or ($c.callbackDate -lt $todayStr))
            $cardBorder = New-Object System.Windows.Controls.Border
            $cardBorder.CornerRadius = [System.Windows.CornerRadius]::new(6)
            $cardBorder.Padding = [System.Windows.Thickness]::new(8,6,8,6)
            $cardBorder.Margin = [System.Windows.Thickness]::new(0,0,0,6)
            $cardBorder.BorderThickness = [System.Windows.Thickness]::new(1)

            $bc = [System.Windows.Media.BrushConverter]::new()
            $curTheme = $script:state.Theme
            if ($isDue) {
                if ($curTheme -eq "light") {
                    $cardBorder.Background = $bc.ConvertFromString("#FEF2F2")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#F87171")
                } elseif ($curTheme -eq "highvis") {
                    $cardBorder.Background = $bc.ConvertFromString("#000000")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#FF0000")
                    $cardBorder.BorderThickness = [System.Windows.Thickness]::new(2)
                } else {
                    $cardBorder.Background = $bc.ConvertFromString("#450A0A")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#EF4444")
                }
            } elseif ($c.status -eq "COMPLETED") {
                if ($curTheme -eq "light") {
                    $cardBorder.Background = $bc.ConvertFromString("#F0FDF4")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#86EFAC")
                } elseif ($curTheme -eq "highvis") {
                    $cardBorder.Background = $bc.ConvertFromString("#000000")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#00FF00")
                    $cardBorder.BorderThickness = [System.Windows.Thickness]::new(2)
                } else {
                    $cardBorder.Background = $bc.ConvertFromString("#064E3B")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#047857")
                }
            } else {
                if ($curTheme -eq "light") {
                    $cardBorder.Background = $bc.ConvertFromString("#FFFFFF")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#CBD5E1")
                } elseif ($curTheme -eq "highvis") {
                    $cardBorder.Background = $bc.ConvertFromString("#000000")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#FFFF00")
                    $cardBorder.BorderThickness = [System.Windows.Thickness]::new(1.5)
                } else {
                    $cardBorder.Background = $bc.ConvertFromString("#0F172A")
                    $cardBorder.BorderBrush = $bc.ConvertFromString("#334155")
                }
            }

            $cardGrid = New-Object System.Windows.Controls.Grid
            $cCol0 = New-Object System.Windows.Controls.ColumnDefinition
            $cCol0.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
            $cCol1 = New-Object System.Windows.Controls.ColumnDefinition
            $cCol1.Width = [System.Windows.GridLength]::Auto
            $cardGrid.ColumnDefinitions.Add($cCol0)
            $cardGrid.ColumnDefinitions.Add($cCol1)

            # Left side details
            $leftStack = New-Object System.Windows.Controls.StackPanel
            $leftStack.Orientation = [System.Windows.Controls.Orientation]::Vertical

            $topRow = New-Object System.Windows.Controls.StackPanel
            $topRow.Orientation = [System.Windows.Controls.Orientation]::Horizontal

            $statusBadge = New-Object System.Windows.Controls.TextBlock
            if ($isDue) {
                $statusBadge.Text = "[DUE NOW] "
                $statusBadge.Foreground = if ($curTheme -eq "highvis") { $bc.ConvertFromString("#FF0000") } else { $bc.ConvertFromString("#EF4444") }
                $statusBadge.FontWeight = [System.Windows.FontWeights]::Bold
            } elseif ($c.status -eq "COMPLETED") {
                $statusBadge.Text = "[DONE] "
                $statusBadge.Foreground = if ($curTheme -eq "highvis") { $bc.ConvertFromString("#00FF00") } elseif ($curTheme -eq "light") { $bc.ConvertFromString("#16A34A") } else { $bc.ConvertFromString("#4ADE80") }
                $statusBadge.FontWeight = [System.Windows.FontWeights]::Bold
            } else {
                $statusBadge.Text = "[SCHEDULED] "
                $statusBadge.Foreground = if ($curTheme -eq "highvis") { $bc.ConvertFromString("#00FFFF") } elseif ($curTheme -eq "light") { $bc.ConvertFromString("#0284C7") } else { $bc.ConvertFromString("#38BDF8") }
                $statusBadge.FontWeight = [System.Windows.FontWeights]::Bold
            }
            $statusBadge.FontSize = 10
            $topRow.Children.Add($statusBadge) | Out-Null

            $nameTb = New-Object System.Windows.Controls.TextBlock
            $nameTb.Text = [string]$c.contactName + " - " + [string]$c.callbackDate + " at " + [string]$c.callbackTime
            if ($curTheme -eq "light") {
                $nameTb.Foreground = if ($isDue) { $bc.ConvertFromString("#991B1B") } elseif ($c.status -eq "COMPLETED") { $bc.ConvertFromString("#166534") } else { $bc.ConvertFromString("#0F172A") }
            } elseif ($curTheme -eq "highvis") {
                $nameTb.Foreground = $bc.ConvertFromString("#FFFF00")
            } else {
                $nameTb.Foreground = $bc.ConvertFromString("#F8FAFC")
            }
            $nameTb.FontWeight = [System.Windows.FontWeights]::Bold
            $nameTb.FontSize = 12
            $topRow.Children.Add($nameTb) | Out-Null

            $leftStack.Children.Add($topRow) | Out-Null

            $contactRow = New-Object System.Windows.Controls.TextBlock
            $contactRow.Text = "Phone: " + [string]$c.phone
            if ($curTheme -eq "light") {
                $contactRow.Foreground = if ($isDue) { $bc.ConvertFromString("#B91C1C") } elseif ($c.status -eq "COMPLETED") { $bc.ConvertFromString("#15803D") } else { $bc.ConvertFromString("#0284C7") }
            } elseif ($curTheme -eq "highvis") {
                $contactRow.Foreground = $bc.ConvertFromString("#00FFFF")
            } else {
                $contactRow.Foreground = $bc.ConvertFromString("#93C5FD")
            }
            $contactRow.FontSize = 11
            $contactRow.Margin = [System.Windows.Thickness]::new(0,2,0,2)
            $leftStack.Children.Add($contactRow) | Out-Null

            if ($c.notes) {
                $notesTb = New-Object System.Windows.Controls.TextBlock
                $notesTb.Text = "Note: " + [string]$c.notes
                if ($curTheme -eq "light") {
                    $notesTb.Foreground = $bc.ConvertFromString("#475569")
                } elseif ($curTheme -eq "highvis") {
                    $notesTb.Foreground = $bc.ConvertFromString("#FFFFFF")
                } else {
                    $notesTb.Foreground = $bc.ConvertFromString("#CBD5E1")
                }
                $notesTb.FontSize = 10
                $notesTb.TextWrapping = [System.Windows.TextWrapping]::Wrap
                $leftStack.Children.Add($notesTb) | Out-Null
            }

            [System.Windows.Controls.Grid]::SetColumn($leftStack, 0)
            $cardGrid.Children.Add($leftStack) | Out-Null

            # Right side actions
            $rightStack = New-Object System.Windows.Controls.StackPanel
            $rightStack.Orientation = [System.Windows.Controls.Orientation]::Horizontal
            $rightStack.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

            # Copy Phone Button
            $btnCpPhone = New-Object System.Windows.Controls.Button
            $btnCpPhone.Content = "Phone"
            $btnCpPhone.Background = $bc.ConvertFromString("#0284C7")
            $btnCpPhone.Foreground = $bc.ConvertFromString("#FFFFFF")
            $btnCpPhone.FontWeight = [System.Windows.FontWeights]::Bold
            $btnCpPhone.FontSize = 10
            $btnCpPhone.Padding = [System.Windows.Thickness]::new(6,4,6,4)
            $btnCpPhone.Margin = [System.Windows.Thickness]::new(0,0,4,0)
            $btnCpPhone.Cursor = [System.Windows.Input.Cursors]::Hand
            $btnCpPhone.ToolTip = "Copy phone to clipboard for Telus"
            $itemPhone = [string]$c.phone
            $btnCpPhone.Add_Click({
                [System.Windows.Clipboard]::SetText($itemPhone)
                $txtStatus.Text = "Copied phone: $itemPhone"
            }.GetNewClosure())
            $rightStack.Children.Add($btnCpPhone) | Out-Null

            # Copy Details Button
            $btnCpDetails = New-Object System.Windows.Controls.Button
            $btnCpDetails.Content = "Text"
            if ($curTheme -eq "light") {
                $btnCpDetails.Background = $bc.ConvertFromString("#E2E8F0")
                $btnCpDetails.Foreground = $bc.ConvertFromString("#334155")
            } elseif ($curTheme -eq "highvis") {
                $btnCpDetails.Background = $bc.ConvertFromString("#000000")
                $btnCpDetails.Foreground = $bc.ConvertFromString("#FFFF00")
                $btnCpDetails.BorderBrush = $bc.ConvertFromString("#FFFF00")
            } else {
                $btnCpDetails.Background = $bc.ConvertFromString("#334155")
                $btnCpDetails.Foreground = $bc.ConvertFromString("#CBD5E1")
            }
            $btnCpDetails.FontSize = 10
            $btnCpDetails.Padding = [System.Windows.Thickness]::new(6,4,6,4)
            $btnCpDetails.Margin = [System.Windows.Thickness]::new(0,0,4,0)
            $btnCpDetails.Cursor = [System.Windows.Input.Cursors]::Hand
            $btnCpDetails.ToolTip = "Copy full summary for email/SMS"
            $itemDetails = "Contact: " + [string]$c.contactName + "`r`nPhone: " + [string]$c.phone + "`r`nScheduled: " + [string]$c.callbackDate + " " + [string]$c.callbackTime + "`r`nNotes: " + [string]$c.notes
            $btnCpDetails.Add_Click({
                [System.Windows.Clipboard]::SetText($itemDetails)
                $txtStatus.Text = "Copied details for " + [string]$c.contactName
            }.GetNewClosure())
            $rightStack.Children.Add($btnCpDetails) | Out-Null

            # Snooze +15m
            $itemId = [string]$c.id
            if ($c.status -eq "PENDING") {
                $btnSnooze = New-Object System.Windows.Controls.Button
                $btnSnooze.Content = "+15m"
                $btnSnooze.Background = $bc.ConvertFromString("#D97706")
                $btnSnooze.Foreground = $bc.ConvertFromString("#FFFFFF")
                $btnSnooze.FontSize = 10
                $btnSnooze.Padding = [System.Windows.Thickness]::new(6,4,6,4)
                $btnSnooze.Margin = [System.Windows.Thickness]::new(0,0,4,0)
                $btnSnooze.Cursor = [System.Windows.Input.Cursors]::Hand
                $btnSnooze.Add_Click({
                    Snooze-Callback $itemId 15
                    $txtStatus.Text = "Snoozed 15 minutes"
                    Render-CallbackCards
                }.GetNewClosure())
                $rightStack.Children.Add($btnSnooze) | Out-Null

                # Mark Done
                $btnDone = New-Object System.Windows.Controls.Button
                $btnDone.Content = "Done"
                $btnDone.Background = $bc.ConvertFromString("#16A34A")
                $btnDone.Foreground = $bc.ConvertFromString("#FFFFFF")
                $btnDone.FontWeight = [System.Windows.FontWeights]::Bold
                $btnDone.FontSize = 10
                $btnDone.Padding = [System.Windows.Thickness]::new(6,4,6,4)
                $btnDone.Margin = [System.Windows.Thickness]::new(0,0,4,0)
                $btnDone.Cursor = [System.Windows.Input.Cursors]::Hand
                $btnDone.Add_Click({
                    Complete-Callback $itemId
                    $txtStatus.Text = "Marked completed!"
                    Render-CallbackCards
                }.GetNewClosure())
                $rightStack.Children.Add($btnDone) | Out-Null
            }

            # Delete button
            $btnDel = New-Object System.Windows.Controls.Button
            $btnDel.Content = "Del"
            if ($curTheme -eq "light") {
                $btnDel.Background = $bc.ConvertFromString("#E2E8F0")
                $btnDel.Foreground = $bc.ConvertFromString("#64748B")
            } elseif ($curTheme -eq "highvis") {
                $btnDel.Background = $bc.ConvertFromString("#000000")
                $btnDel.Foreground = $bc.ConvertFromString("#FF0000")
                $btnDel.BorderBrush = $bc.ConvertFromString("#FF0000")
            } else {
                $btnDel.Background = $bc.ConvertFromString("#475569")
                $btnDel.Foreground = $bc.ConvertFromString("#FFFFFF")
            }
            $btnDel.FontSize = 10
            $btnDel.Padding = [System.Windows.Thickness]::new(5,4,5,4)
            $btnDel.Cursor = [System.Windows.Input.Cursors]::Hand
            $btnDel.ToolTip = "Delete callback"
            $btnDel.Add_Click({
                Delete-Callback $itemId
                $txtStatus.Text = "Deleted callback"
                Render-CallbackCards
            }.GetNewClosure())
            $rightStack.Children.Add($btnDel) | Out-Null

            [System.Windows.Controls.Grid]::SetColumn($rightStack, 1)
            $cardGrid.Children.Add($rightStack) | Out-Null

            $cardBorder.Child = $cardGrid
            $container.Children.Add($cardBorder) | Out-Null
        }
    }

    # Filter tab events
    $mgrWin.FindName("BtnFilterAll").Add_Click({ $script:currentFilter = "all"; Apply-CallbackManagerFilterStyles $mgrWin $script:state.Theme; Render-CallbackCards })
    $mgrWin.FindName("BtnFilterDue").Add_Click({ $script:currentFilter = "due"; Apply-CallbackManagerFilterStyles $mgrWin $script:state.Theme; Render-CallbackCards })
    $mgrWin.FindName("BtnFilterPending").Add_Click({ $script:currentFilter = "pending"; Apply-CallbackManagerFilterStyles $mgrWin $script:state.Theme; Render-CallbackCards })
    $mgrWin.FindName("BtnFilterDone").Add_Click({ $script:currentFilter = "done"; Apply-CallbackManagerFilterStyles $mgrWin $script:state.Theme; Render-CallbackCards })

    # Add Callback Event
    $mgrWin.FindName("BtnAddCallback").Add_Click({
        $name = $tbName.Text.Trim()
        $phone = $tbPhone.Text.Trim()
        $email = ""
        $date = $tbDate.Text.Trim()
        $time = $tbTime.Text.Trim()
        $notes = $tbNotes.Text.Trim()

        if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($phone)) {
            $txtStatus.Text = "Please enter at least Name or Phone."
            return
        }

        Add-CallbackItem $name $phone $email $date $time $notes
        $tbName.Text = ""
        $tbPhone.Text = ""
        $tbNotes.Text = ""
        $tbTime.Text = (Get-Date).AddMinutes(30).ToString("hh:mm tt")
        $txtStatus.Text = "Callback saved for " + $name + "!"
        Render-CallbackCards
    })

    # Copy All for Excel (TSV)
    $mgrWin.FindName("BtnMgrCopyAllExcel").Add_Click({
        $cbs = Get-CallbacksList
        $header = "Name`tPhone`tEmail`tDate`tTime`tNotes`tStatus"
        $lines = @($header)
        foreach ($c in $cbs) {
            $lines += "$($c.contactName)`t$($c.phone)`t$($c.email)`t$($c.callbackDate)`t$($c.callbackTime)`t$($c.notes)`t$($c.status)"
        }
        $tsv = $lines -join "`r`n"
        [System.Windows.Clipboard]::SetText($tsv)
        $txtStatus.Text = "All callbacks copied in Excel format!"
    })

    $script:RenderCallbackCardsAction = {
        Apply-CallbackManagerTheme $mgrWin $script:state.Theme
        Render-CallbackCards
    }
    $mgrWin.Add_Closed({
        $script:cbManagerWindow = $null
        $script:RenderCallbackCardsAction = $null
    })

    Apply-CallbackManagerTheme $mgrWin $script:state.Theme
    Render-CallbackCards
    $mgrWin.Show()
}

# Session state saver
function Save-SessionState {
    $json = $script:state | ConvertTo-Json -Depth 4
    Set-Content -Path $script:sessionFile -Value $json -Force
    Export-LocalDataJs
}

function Get-ActiveSeconds {
    if ($script:state.Status -eq "OFFLINE" -or $script:state.StartTime -eq 0) { return 0 }
    $now = Get-NowEpochMs
    $gross = 0
    if ($script:state.Status -eq "RUNNING") {
        $gross = ($now - $script:state.StartTime) - $script:state.TotalPausedMs
    } elseif ($script:state.Status -eq "PAUSED") {
        $gross = ($script:state.PauseStartTime - $script:state.StartTime) - $script:state.TotalPausedMs
    }
    return [Math]::Max(0, [Math]::Floor($gross / 1000))
}

function Get-TodayTotalSeconds {
    $todayKey = (Get-Date).ToString("yyyy-MM-dd")
    $total = 0
    if (Test-Path $script:dataFile) {
        try {
            $shifts = Get-Content $script:dataFile -Raw | ConvertFrom-Json
            foreach ($s in $shifts) {
                if ($s.date -eq $todayKey) {
                    $total += [int]$s.durationSeconds
                }
            }
        } catch {}
    }
    $total += (Get-ActiveSeconds)
    return $total
}

function Format-Stopwatch($secs) {
    $h = [int][Math]::Floor($secs / 3600)
    $m = [int][Math]::Floor(($secs % 3600) / 60)
    $s = [int]($secs % 60)
    return ("{0:D2}:{1:D2}:{2:D2}" -f $h, $m, $s)
}

function Format-HoursMins($secs) {
    $h = [int][Math]::Floor($secs / 3600)
    $m = [int][Math]::Floor(($secs % 3600) / 60)
    return ("{0}h {1:D2}m" -f $h, $m)
}

# Transport Controls Actions
$BtnRec.Add_Click({
    $now = Get-NowEpochMs
    if ($script:state.Status -eq "OFFLINE") {
        $script:state.StartTime = $now
        $script:state.LastActivitySwitchTime = $now
        $script:state.PauseStartTime = 0
        $script:state.TotalPausedMs = 0
        $script:state.Status = "RUNNING"
    } elseif ($script:state.Status -eq "PAUSED") {
        $pauseDur = $now - $script:state.PauseStartTime
        $script:state.TotalPausedMs += $pauseDur
        $script:state.PauseStartTime = 0
        $script:state.LastActivitySwitchTime = $now
        $script:state.Status = "RUNNING"
    }
    Update-UIState
    Save-SessionState
})

$BtnPause.Add_Click({
    if ($script:state.Status -eq "RUNNING") {
        $now = Get-NowEpochMs
        Accumulate-ActiveTime $now
        $script:state.Status = "PAUSED"
        $script:state.PauseStartTime = $now
        Update-UIState
        Save-SessionState
    }
})

$BtnStop.Add_Click({
    if ($script:state.Status -ne "OFFLINE") {
        $now = Get-NowEpochMs
        if ($script:state.Status -eq "RUNNING") {
            Accumulate-ActiveTime $now
        } elseif ($script:state.Status -eq "PAUSED") {
            $script:state.TotalPausedMs += ($now - $script:state.PauseStartTime)
        }
        $netSeconds = [Math]::Max(0, [Math]::Floor((($now - $script:state.StartTime) - $script:state.TotalPausedMs) / 1000))

        if ($netSeconds -ge 10) {
            # Exact sum from all activity taps
            $phoneSec = [int]$script:state.ActivityMap['inbound_call'] + [int]$script:state.ActivityMap['outbound_call']
            $offPhoneSec = [int]$script:state.ActivityMap['text_sms'] + [int]$script:state.ActivityMap['email_in'] + [int]$script:state.ActivityMap['off_phone_work']
            
            # Any remaining unallocated seconds go to off-phone
            $totalAllocated = $phoneSec + $offPhoneSec
            if ($totalAllocated -lt $netSeconds) {
                $offPhoneSec += ($netSeconds - $totalAllocated)
            }

            $shiftsList = @()
            if (Test-Path $script:dataFile) {
                try {
                    $existing = Get-Content $script:dataFile -Raw | ConvertFrom-Json
                    if ($existing) { $shiftsList = @($existing) }
                } catch {}
            }

            $newShift = [pscustomobject]@{
                id = "shift_" + $now
                date = (Get-Date).ToString("yyyy-MM-dd")
                startTime = $script:state.StartTime
                endTime = $now
                durationSeconds = $netSeconds
                phoneSeconds = $phoneSec
                offPhoneSeconds = $offPhoneSec
                appointmentsBooked = $script:state.TodayAppts
                eventCounts = $script:state.EventCounts
                events = $script:state.Events
                activityBreakdown = $script:state.ActivityMap
                notes = "Multi-event shift segment"
            }

            $shiftsList = @($newShift) + @($shiftsList)
            @($shiftsList) | ConvertTo-Json -Depth 5 | Set-Content -Path $script:dataFile -Force

            # Automatic timestamped backup
            try {
                $backupDir = Join-Path $script:dataDir "backups"
                if (!(Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }
                $backupTime = (Get-Date).ToString("yyyyMMdd_HHmmss")
                Copy-Item -Path $script:dataFile -Destination (Join-Path $backupDir "shifts_backup_$backupTime.json") -Force
            } catch {}
        }

        # Reset session
        $script:state.Status = "OFFLINE"
        $script:state.StartTime = 0
        $script:state.PauseStartTime = 0
        $script:state.TotalPausedMs = 0
        $script:state.LastActivitySwitchTime = 0
        $script:state.ActivityMap = @{ inbound_call = 0; outbound_call = 0; text_sms = 0; email_in = 0; off_phone_work = 0 }
        $script:state.EventCounts = @{ inbound_call = 0; outbound_call = 0; text_sms = 0; email_in = 0; off_phone_work = 0 }
        $script:state.Events = @()
        Update-UIState
        Save-SessionState
    }
})

function Update-UIState {
    if ($script:state.Status -eq "OFFLINE") {
        $LedIndicator.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#64748B")
        $TxtStatus.Text = "OFFLINE"
        $TxtStatus.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#94A3B8")
        $BtnRec.IsEnabled = $true
        $BtnRec.Content = "REC"
        $BtnPause.IsEnabled = $false
        $BtnStop.IsEnabled = $false
    } elseif ($script:state.Status -eq "RUNNING") {
        $LedIndicator.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#22C55E")
        $TxtStatus.Text = "REC (ON)"
        $TxtStatus.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#4ADE80")
        $BtnRec.IsEnabled = $false
        $BtnPause.IsEnabled = $true
        $BtnStop.IsEnabled = $true
    } elseif ($script:state.Status -eq "PAUSED") {
        $LedIndicator.Fill = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#F59E0B")
        $TxtStatus.Text = "PAUSED"
        $TxtStatus.Foreground = [System.Windows.Media.BrushConverter]::new().ConvertFromString("#FBBF24")
        $BtnRec.IsEnabled = $true
        $BtnRec.Content = "RESUME"
        $BtnPause.IsEnabled = $false
        $BtnStop.IsEnabled = $true
    }

    $TxtAppts.Text = $script:state.TodayAppts.ToString()
    Set-ActiveActivity $script:state.CurrentActivity
}

# 1-second Dispatcher Timer
$script:flashState = $false
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
    $TxtClock.Text = (Get-Date).ToString("hh:mm tt")
    $activeSec = Get-ActiveSeconds
    $todaySec = Get-TodayTotalSeconds
    $TxtSessionDigits.Text = Format-Stopwatch $activeSec
    $TxtTodayDigits.Text = Format-HoursMins $todaySec

    # Callbacks check & flashing alert
    $dueCbs = Get-PendingDueCallbacks
    $pendingTotal = Get-TodayPendingCallbacksCount
    $script:flashState = !$script:flashState
    
    if ($dueCbs.Count -gt 0) {
        $BtnActCallbacks.Content = "CALL! (" + $dueCbs.Count + ")"
        $bc = [System.Windows.Media.BrushConverter]::new()
        if ($script:flashState) {
            $BtnActCallbacks.Background = $bc.ConvertFromString("#EF4444")
            $BtnActCallbacks.Foreground = $bc.ConvertFromString("#FFFFFF")
            $BtnActCallbacks.BorderBrush = $bc.ConvertFromString("#F87171")
        } else {
            $BtnActCallbacks.Background = $bc.ConvertFromString("#F59E0B")
            $BtnActCallbacks.Foreground = $bc.ConvertFromString("#000000")
            $BtnActCallbacks.BorderBrush = $bc.ConvertFromString("#FBBF24")
        }

        # Check for un-alerted due callbacks to trigger popup
        foreach ($cb in $dueCbs) {
            if (!$cb.alerted) {
                $cb.alerted = $true
                Save-CallbacksList (Get-CallbacksList)
                Show-CallbackToast $cb
                break
            }
        }
    } else {
        $BtnActCallbacks.Content = "Callbacks ($pendingTotal)"
        $bc = [System.Windows.Media.BrushConverter]::new()
        $curTheme = $script:themes[$script:themeIndex]
        if ($curTheme -eq "light") {
            $BtnActCallbacks.Background = $bc.ConvertFromString("#FEF3C7")
            $BtnActCallbacks.Foreground = $bc.ConvertFromString("#92400E")
            $BtnActCallbacks.BorderBrush = $bc.ConvertFromString("#F59E0B")
        } elseif ($curTheme -eq "highvis") {
            $BtnActCallbacks.Background = $bc.ConvertFromString("#000000")
            $BtnActCallbacks.Foreground = $bc.ConvertFromString("#FFFF00")
            $BtnActCallbacks.BorderBrush = $bc.ConvertFromString("#FFFF00")
        } else {
            $BtnActCallbacks.Background = $bc.ConvertFromString("#78350F")
            $BtnActCallbacks.Foreground = $bc.ConvertFromString("#FDE047")
            $BtnActCallbacks.BorderBrush = $bc.ConvertFromString("#D97706")
        }
    }

    # 5-minute rolling auto-save snapshot
    $script:snapTick = if ($script:snapTick) { $script:snapTick + 1 } else { 1 }
    if ($script:snapTick -ge 300) {
        $script:snapTick = 0
        Save-5MinSnapshot
    }
})

# Initial setup
Apply-Theme $Theme
Update-UIState
$window.Title = "Sabrina Transport Bar v$($script:appVersion)"
$TxtClock.Text = (Get-Date).ToString("hh:mm tt")
$TxtSessionDigits.Text = Format-Stopwatch (Get-ActiveSeconds)
$TxtTodayDigits.Text = Format-HoursMins (Get-TodayTotalSeconds)
Save-5MinSnapshot
$timer.Start()

if ($Test) {
    if ($Screenshot) {
        $border = $window.Content
        $border.Measure([System.Windows.Size]::new(600, 165))
        $border.Arrange([System.Windows.Rect]::new(0, 0, 600, 165))
        $border.UpdateLayout()
        $render = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(600, 165, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
        $render.Render($border)
        $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
        $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($render))
        $stream = [System.IO.File]::Create($Screenshot)
        $encoder.Save($stream)
        $stream.Close()
        Write-Output "Screenshot saved to $Screenshot"
    }
    if ($ModalScreenshot) {
        if ($ModalType -eq "callback") {
            Show-CallbackManager
            $mgrBorder = $script:cbManagerWindow.Content
            $mgrBorder.Measure([System.Windows.Size]::new(720, 640))
            $mgrBorder.Arrange([System.Windows.Rect]::new(0, 0, 720, 640))
            $mgrBorder.UpdateLayout()
            $render = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(720, 640, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
            $render.Render($mgrBorder)
            $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
            $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($render))
            $stream = [System.IO.File]::Create($ModalScreenshot)
            $encoder.Save($stream)
            $stream.Close()
            Write-Output "Modal screenshot saved to $ModalScreenshot"
        } elseif ($ModalType -eq "appt") {
            $apptWin = Show-QuickApptModal -NoShow
            $apptBorder = $apptWin.Content
            $apptBorder.Measure([System.Windows.Size]::new(440, 520))
            $apptBorder.Arrange([System.Windows.Rect]::new(0, 0, 440, 520))
            $apptBorder.UpdateLayout()
            $render = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(440, 520, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
            $render.Render($apptBorder)
            $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
            $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($render))
            $stream = [System.IO.File]::Create($ModalScreenshot)
            $encoder.Save($stream)
            $stream.Close()
            Write-Output "Modal screenshot saved to $ModalScreenshot"
        }
    }
    Write-Output "WPF Window Initialized Cleanly"
    exit 0
}

# Display Window
$window.ShowDialog() | Out-Null
$timer.Stop()
