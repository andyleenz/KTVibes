#define AppName "KTVibes"
#ifndef AppVersion
#error AppVersion must be provided by the build workflow from pyproject.toml
#endif
#define AppPublisher "Andrew Lee"

[Setup]
AppId={{EA0A57B7-CDBE-4AB6-8B0B-80710E37A426}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\KTVibes
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=KTVibes-Setup-x64
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
SetupIconFile=KTVibes.ico

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "..\..\ktvibes\*"; DestDir: "{app}\ktvibes"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\static\*"; DestDir: "{app}\static"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\pyproject.toml"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\uv.lock"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}\licenses"; Flags: ignoreversion
Source: "bootstrap.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "python-runtime.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "KTVibes.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "KTVibes.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "tray.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "network-settings.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "show-logs.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "stop-running.ps1"; Flags: dontcopy
Source: "KTVibes.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "THIRD_PARTY_NOTICES.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\KTVibes"; Filename: "{app}\KTVibes.exe"; WorkingDir: "{app}"; IconFilename: "{app}\KTVibes.ico"
Name: "{autodesktop}\KTVibes"; Filename: "{app}\KTVibes.exe"; WorkingDir: "{app}"; IconFilename: "{app}\KTVibes.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\KTVibes.exe"; Description: "Launch KTVibes"; Flags: postinstall nowait skipifsilent

[InstallDelete]
Type: filesandordirs; Name: "{app}\network-ui"
Type: filesandordirs; Name: "{app}\tools\dotnet"
Type: files; Name: "{app}\installer\network-ui-bridge.ps1"
Type: filesandordirs; Name: "{localappdata}\KTVibes\ipc"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.venv"
Type: filesandordirs; Name: "{app}\.uv-cache"
Type: filesandordirs; Name: "{app}\tools"
Type: filesandordirs; Name: "{app}\.installer-temp"
Type: files; Name: "{app}\setup.log"

[Code]
var
  DeleteCacheOnUninstall: Boolean;
  ComponentProgressPage: TOutputMarqueeProgressWizardPage;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  PowerShellPath: String;
  Parameters: String;
begin
  Result := '';
  ExtractTemporaryFile('stop-running.ps1');
  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\stop-running.ps1') + '" -InstallDir "' + ExpandConstant('{app}') + '"';
  if not Exec(PowerShellPath, Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    Result := 'Could not stop the existing KTVibes process. Close KTVibes and run the installer again.'
  else if ResultCode <> 0 then
    Result := 'Could not stop the existing KTVibes process. Close KTVibes and run the installer again.';
end;

procedure InitializeWizard;
begin
  ComponentProgressPage := CreateOutputMarqueeProgressPage(
    'Installing KTVibes components',
    'This may take several minutes. The installer will continue when setup is complete.');
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  DeleteCacheOnUninstall := False;
  if DirExists(ExpandConstant('{app}\cache')) then
    DeleteCacheOnUninstall := MsgBox('Do you also want to delete cached songs, queue data, and downloaded models?' + #13#10 + #13#10 + 'Choose No to keep them for a later reinstall.', mbConfirmation, MB_YESNO) = IDYES;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usUninstall) and DeleteCacheOnUninstall then
    DelTree(ExpandConstant('{app}\cache'), True, True, True);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShellPath: String;
  Parameters: String;
  StatusFile: String;
  ResultFile: String;
  StatusText: AnsiString;
  SetupResult: AnsiString;
  ElapsedMilliseconds: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.ProgressGauge.Visible := False;
    PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
    Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installer\bootstrap.ps1') + '" -InstallDir "' + ExpandConstant('{app}') + '"';
    StatusFile := ExpandConstant('{app}\.installer-status');
    ResultFile := ExpandConstant('{app}\.installer-result');
    DeleteFile(StatusFile);
    DeleteFile(ResultFile);
    ComponentProgressPage.Show;
    try
      if not Exec(PowerShellPath, Parameters, ExpandConstant('{app}'), SW_HIDE, ewNoWait, ResultCode) then
        RaiseException('Could not start the KTVibes setup helper. Please restart setup.');
      ElapsedMilliseconds := 0;
      while not FileExists(ResultFile) do
      begin
        if LoadStringFromFile(StatusFile, StatusText) then
          ComponentProgressPage.SetText('Installing KTVibes components', StatusText);
        ComponentProgressPage.Animate;
        Sleep(100);
        ElapsedMilliseconds := ElapsedMilliseconds + 100;
        if ElapsedMilliseconds >= 3600000 then
          RaiseException('KTVibes setup did not finish within one hour. Check setup.log in the selected install folder.');
      end;
      if not LoadStringFromFile(ResultFile, SetupResult) then
        RaiseException('Could not read the KTVibes setup result. Check setup.log in the selected install folder.');
      SetupResult := Trim(SetupResult);
      DeleteFile(StatusFile);
      DeleteFile(ResultFile);
      if SetupResult <> '0' then
        RaiseException('KTVibes setup could not install its runtime or dependencies. Check setup.log in the selected install folder for details, then run the installer again.');
    finally
      ComponentProgressPage.Hide;
    end;
  end;
end;
