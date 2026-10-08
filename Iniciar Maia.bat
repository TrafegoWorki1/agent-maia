@echo off
title Maia - Worki Digital
cd /d "%~dp0"
node scripts\start.ts
echo.
echo Maia parou. Pressione uma tecla para fechar.
pause >nul
