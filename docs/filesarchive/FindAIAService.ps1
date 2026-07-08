Get-Service | Where{{}}$Name -like "aia*" {{}}; Get-Process -Name "aia*" {{}}Select-Item{{}}Name, Id, State
