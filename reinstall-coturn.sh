#!/bin/bash

echo "🔄 Полная переустановка Coturn"
echo "=============================="

# Проверяем права root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Запустите от имени root: sudo ./reinstall-coturn.sh"
    exit 1
fi

echo "📋 Шаг 1: Остановка и удаление Coturn..."

# Останавливаем службу
systemctl stop coturn 2>/dev/null
systemctl disable coturn 2>/dev/null

# Убиваем все процессы turnserver
pkill -f turnserver 2>/dev/null

# Удаляем пакет
apt-get remove --purge -y coturn

# Удаляем конфигурационные файлы
rm -rf /etc/coturn
rm -rf /var/lib/coturn
rm -f /var/log/coturn.log
rm -f /etc/default/coturn

echo "✅ Coturn полностью удален"

echo ""
echo "📋 Шаг 2: Обновление пакетов..."
apt-get update

echo ""
echo "📋 Шаг 3: Установка Coturn..."
apt-get install -y coturn

echo ""
echo "📋 Шаг 4: Создание конфигурации..."

# Создаем директорию для конфигурации
mkdir -p /etc/coturn

# Создаем простую рабочую конфигурацию
cat > /etc/coturn/turnserver.conf << 'EOF'
# Простая рабочая конфигурация Coturn
listening-port=3478
external-ip=185.117.154.193
min-port=49152
max-port=65535
lt-cred-mech
use-auth-secret
static-auth-secret=my_secure_secret_key_2024
realm=zloer
log-file=/var/log/coturn.log
no-cli
pidfile=/var/run/turnserver.pid
EOF

echo "✅ Конфигурация создана"

echo ""
echo "📋 Шаг 5: Настройка разрешений..."

# Создаем лог файл
touch /var/log/coturn.log
chown turnserver:turnserver /var/log/coturn.log 2>/dev/null || chown root:root /var/log/coturn.log

# Устанавливаем права на конфигурацию
chmod 644 /etc/coturn/turnserver.conf

echo ""
echo "📋 Шаг 6: Включение службы..."

# Включаем coturn в /etc/default/coturn
echo 'TURNSERVER_ENABLED=1' > /etc/default/coturn

echo ""
echo "📋 Шаг 7: Проверка конфигурации..."
turnserver --check-config -c /etc/coturn/turnserver.conf

if [ $? -eq 0 ]; then
    echo "✅ Конфигурация корректна"
else
    echo "❌ Ошибка в конфигурации"
    exit 1
fi

echo ""
echo "📋 Шаг 8: Запуск службы..."
systemctl enable coturn
systemctl start coturn

# Ждем немного
sleep 3

# Проверяем статус
if systemctl is-active --quiet coturn; then
    echo "✅ Coturn успешно запущен!"
    
    echo ""
    echo "📋 Проверка портов..."
    netstat -tulpn | grep -E "(3478|49152)" | head -5
    
    echo ""
    echo "🎯 Готово! Coturn установлен и работает"
    echo "📊 Проверить статус: sudo systemctl status coturn"
    echo "📋 Посмотреть логи: sudo journalctl -u coturn -f"
    
else
    echo "❌ Ошибка запуска Coturn"
    echo "📋 Статус службы:"
    systemctl status coturn --no-pager
    echo ""
    echo "📋 Логи:"
    journalctl -u coturn --no-pager -n 10
fi

echo ""
echo "🔧 Настройка файрвола..."
ufw allow 3478/udp 2>/dev/null
ufw allow 3478/tcp 2>/dev/null
ufw allow 49152:65535/udp 2>/dev/null

echo "✅ Порты открыты в файрволе"