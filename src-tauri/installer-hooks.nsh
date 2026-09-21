; "Open in DCode-IDE" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInDCode" "" "Open in DCode-IDE"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInDCode" "Icon" '"$INSTDIR\dcode.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInDCode" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInDCode\command" "" '"$INSTDIR\dcode.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInDCode" "" "Open in DCode-IDE"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInDCode" "Icon" '"$INSTDIR\dcode.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInDCode" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInDCode\command" "" '"$INSTDIR\dcode.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInDCode" "" "Open in DCode-IDE"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInDCode" "Icon" '"$INSTDIR\dcode.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInDCode" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInDCode\command" "" '"$INSTDIR\dcode.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInDCode"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInDCode"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInDCode"
!macroend
