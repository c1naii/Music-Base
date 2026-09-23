# Music Base

Desktop-приложение Cinailo Corporation.

## Сборка Windows

```powershell
npm.cmd install
npm.cmd run check
npm.cmd test
npm.cmd run build:win
```

Локальная сборка создаёт `release/Music Base Setup.exe`, `release/Music Base Setup.exe.blockmap` и `release/latest.yml`. Установленное приложение и исполняемый файл называются `Music Base`.

## Обновления через GitHub Releases

Источником обновлений служит [c1naii/Music-Base](https://github.com/c1naii/Music-Base). Приложение проверяет новые выпуски после запуска и затем каждые шесть часов. Когда выпуск доступен, оно показывает номер новой версии и кнопку «Обновить». Кнопка скачивает новую версию, устанавливает её и перезапускает приложение. Полный список изменений размещается только в GitHub Release.

Для нового выпуска увеличьте `version` в `package.json` и обновите `package-lock.json` командой `npm.cmd install --package-lock-only`. Команда `npm.cmd run publish:win` создаёт сборку и загружает установщик, `latest.yml` и `.blockmap` в GitHub Release с тегом `v<version>` при наличии `GH_TOKEN` с доступом к репозиторию. Перед публикацией заполните описание выпуска. GitHub получает установщик под безопасным именем `Music-Base-Setup.exe`, которое уже указано в `latest.yml`; локальный файл при этом называется `Music Base Setup.exe`. При ручной загрузке файлов в Release используйте имена из `latest.yml` для установщика и соответствующего `.blockmap`.

Автообновление проверяется в установленной сборке Windows. В режиме `npm.cmd start` сетевой поиск обновлений отключён.

## Настройки

Язык интерфейса и материалов, заставка, визуальные эффекты, положение и размер окна сохраняются локально в пользовательских данных приложения. Русский язык, заставка и анимация включены по умолчанию.
