; Custom NSIS installer hooks for SpaceCode
; electron-builder automatically loads build/installer.nsh

; --- Post-install: add Windows Defender exclusion ---
; Prevents slow first-launch caused by Defender real-time scanning
; of unsigned bun.exe (~111 MB). Requires admin; silently skipped otherwise.
!macro customInstall
  DetailPrint "Adding Windows Defender exclusion for $INSTDIR ..."
  nsExec::ExecToStack "powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command Add-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue"
  Pop $0
!macroend

; --- Uninstall: remove the exclusion ---
!macro customUnInstall
  nsExec::ExecToStack "powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -Command Remove-MpPreference -ExclusionPath '$INSTDIR' -ErrorAction SilentlyContinue"
  Pop $0
!macroend
