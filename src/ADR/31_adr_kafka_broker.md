# ADR-002: Выбор Apache Kafka как message broker

**Статус**: Принято  
**Дата**: 2025-11-18  
**Авторы**: Архитектурная команда  
**Теги**: messaging, event-driven, Kafka, microservices

---

## Контекст и формулировка проблемы

Система умного КПП построена на микросервисной архитектуре с асинхронной обработкой событий. Требуется надежный message broker для:

- **Событийно-ориентированная архитектура**: распространение событий между сервисами (распознавание → контроль доступа → аудит)
- **Decoupling сервисов**: отправитель не знает о получателях, получатели могут появляться/исчезать
- **Высокая пропускная способность**: 100-500 событий/минута в пиковые часы
- **Гарантия доставки**: критичные события (access.decision) не должны теряться
- **Масштабируемость**: возможность обработки до 10 камер (до 1000 событий/мин)

**Требования**:
- Throughput: 500+ messages/sec
- Latency: <500ms (end-to-end)
- Durability: сохранение сообщений минимум 7 дней
- Exactly-once semantics (для критичных событий)
- Горизонтальное масштабирование (partitions)

---

## Рассмотренные варианты

### Вариант 1: Apache Kafka (ВЫБРАН)

**За**:
- **Высокая пропускная способность**: миллионы сообщений/сек на кластере
- **Durability**: сообщения сохраняются на диск (не только в RAM)
- **Retention policies**: можем хранить события 7+ дней для replay
- **Partitioning**: параллельная обработка через партиции (8 партиций = 8 consumers параллельно)
- **Exactly-once semantics**: критично для финансовых/аудит систем
- **Consumer groups**: множественные consumers на один топик
- **Replay capability**: можно переиграть события (важно для отладки и recovery)
- **Зрелость**: используется в LinkedIn, Uber, Netflix

**Против**:
- **Сложность**: требует Zookeeper (хотя в Kafka 3+ можно без него через KRaft)
- **Overhead**: избыточен для малых объемов (<100 msg/sec)
- **Операционная сложность**: требует мониторинга и тюнинга

### Вариант 2: RabbitMQ

**За**:
- Простота настройки и использования
- Хорошая производительность для средних нагрузок
- Гибкая маршрутизация (exchanges, routing keys)
- Management UI из коробки

**Против**:
- **Throughput**: уступает Kafka при высоких нагрузках
- **Durability**: сообщения в RAM, disk persistence медленнее
- **Retention**: не предназначен для долгого хранения сообщений
- **No replay**: нельзя переиграть сообщения после consume

### Вариант 3: Redis Pub/Sub

**За**:
- Очень низкая latency (<1ms)
- Простота (Redis уже используется для кэша)
- Легковесное решение

**Против**:
- **Fire-and-forget**: нет гарантии доставки (at-most-once)
- **No persistence**: сообщения только в RAM, при рестарте теряются
- **No replay**: невозможно переиграть события
- **Не подходит для critical events** (access.decision не может потеряться)

### Вариант 4: AWS SQS / Cloud-based

**За**:
- Полностью управляемый сервис
- Автоматическое масштабирование
- Высокая доступность

**Против**:
- **On-premise требование**: система должна работать без облака
- **Vendor lock-in**: зависимость от AWS
- **Latency**: выше чем у on-premise решений
- **Стоимость**: платный сервис

---

## Решение

**Выбран Apache Kafka** как message broker для асинхронной коммуникации между микросервисами.

**Архитектурное решение**:

### Топология кластера
- **3 узла Kafka** (минимум для fault tolerance)
- **3 узла Zookeeper** (координация кластера)
- **Replication factor**: 2 (каждое сообщение на 2 узлах)
- **8 партиций** на топик (для параллелизма)

### Топики системы
```
user.registered         - регистрация пользователей
user.updated            - обновление профилей
user.deleted            - деактивация

recognition.face        - события распознавания лиц
recognition.vehicle     - события распознавания авто

access.decision         - решения о доступе
access.granted          - успешные проходы
access.denied           - отказы в доступе

notifications           - уведомления и алерты
audit.system            - системные события
```

### Retention policies
- **Critical topics** (access.*): 30 дней
- **Recognition events** (recognition.*): 7 дней
- **Notifications**: 3 дня
- **Audit**: 90 дней

### Consumer groups
- `access-control-service` (подписан на recognition.*)
- `audit-service` (подписан на все топики)
- `notification-service` (подписан на notifications)

---

## Обоснование

1. **Event Sourcing**: Kafka идеально подходит для event sourcing паттерна. Все события системы хранятся в упорядоченном логе, можно переиграть историю.

2. **Decoupling**: Сервисы полностью развязаны. Recognition Service публикует события и не знает, кто их обработает. Завтра можем добавить новый сервис-потребитель без изменений в Recognition Service.

3. **Durability**: События сохраняются на диск. При падении consumer, после восстановления он продолжит с last committed offset. Нет потери данных.

4. **Replay для отладки**: При багах в Access Control Service можем переиграть события recognition.face за последние 7 дней для воспроизведения проблемы.

5. **Horizontal scaling**: Если нагрузка растет, добавляем узлы в кластер и увеличиваем количество партиций. Consumer groups автоматически перебалансируются.

6. **Audit trail**: Kafka сам по себе - аудит лог всех событий системы. Соответствует требованиям compliance.

---

## Последствия

### Позитивные:
- Высокая надежность доставки сообщений
- Масштабируемость под будущий рост (до 50 камер)
- Decoupling сервисов (слабая связанность)
- Возможность добавления новых consumers без изменения producers
- Built-in monitoring (Kafka Manager, Burrow для consumer lag)

### Негативные:
- **Операционная сложность**: требуется выделенная команда DevOps
  - Мониторинг: partition lag, broker health, disk usage
  - Настройка: replication, partitions, retention
  - Backup: topic exports для disaster recovery

- **Overhead**: для малых нагрузок (<50 msg/sec) избыточен
  - Но система рассчитана на рост, overhead оправдан

- **Latency**: 100-500ms (больше чем Redis Pub/Sub)
  - Но для нашего use case (не HFT) приемлемо

### Риски и митигации:

**Риск 1**: Consumer lag (consumers не успевают обрабатывать сообщения)  
**Митигация**:
- Мониторинг lag через Burrow / Prometheus
- Auto-scaling consumers (Kubernetes HPA)
- Оптимизация обработки (batch processing, async I/O)

**Риск 2**: Потеря данных при отказе брокера  
**Митигация**:
- Replication factor = 2 (минимум)
- min.insync.replicas = 2 (для critical topics)
- acks=all для producers (гарантия записи на реплики)

**Риск 3**: Disk space exhaustion  
**Митигация**:
- Retention policies (автоматическое удаление старых сообщений)
- Monitoring disk usage (alert при >80%)
- Log compaction для топиков типа "latest state"

---

## Альтернативы для специфических задач

Хотя Kafka - основной message broker, для специфических задач используются:

1. **Redis Pub/Sub** - для real-time WebSocket notifications (Web UI live feed)
   - Низкая latency критична
   - Потеря сообщений допустима (UI refresh)

2. **HTTP webhooks** - для интеграции с внешними системами (ERP, Time Tracking)
   - Синхронный вызов для immediate feedback
   - Retry mechanism в application layer

---

## Связанные решения

- [ADR-001: Выбор PostgreSQL](./30_adr_database_choice.md)
- [ADR-003: Микросервисная архитектура](./31_adr_microservices.md)
- [ADR-005: Event-driven architecture](./32_adr_event_driven.md)

---

## Ссылки

- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Kafka: The Definitive Guide](https://www.confluent.io/resources/kafka-the-definitive-guide/)
- [Event Sourcing with Kafka](https://www.confluent.io/blog/event-sourcing-cqrs-stream-processing-apache-kafka-whats-connection/)
- [Kafka Performance Tuning](https://docs.confluent.io/platform/current/kafka/deployment.html)

---

**Последнее обновление**: 2025-11-18
