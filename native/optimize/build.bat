@echo off
REM MSVC build for the artifact optimiser. Run from this folder in a
REM "x64 Native Tools Command Prompt" or after vcvars64.bat.
cl /nologo /O2 /std:c++17 /EHsc /W4 /Fe:optimize.exe main.cpp
