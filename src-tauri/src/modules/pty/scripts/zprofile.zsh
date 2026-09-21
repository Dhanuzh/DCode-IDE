# dcode-shell-integration (zprofile)
#
# See zshenv.zsh for the rationale on the trailing `:`.
{
  _dcode_user_zdotdir="${DCODE_USER_ZDOTDIR:-$HOME}"
  [ -f "$_dcode_user_zdotdir/.zprofile" ] && source "$_dcode_user_zdotdir/.zprofile"
  unset _dcode_user_zdotdir
}
:
