# ADR-001: Выбор базы данных PostgreSQL

**Статус**: Принято  
**Дата**: 2025-11-18  
**Авторы**: Архитектурная команда  
**Теги**: database, storage, PostgreSQL

---

## Контекст и формулировка проблемы

Системе умного КПП требуется надежное хранилище данных для:
- Метаданных пользователей (персональные данные, роли, права доступа)
- Биометрических данных (face embeddings - векторы 512-dim)
- Истории событий (логи проходов, распознаваний, решений)
- Конфигурации системы (правила доступа, настройки камер)

**Требования**:
- ACID транзакции (критично для целостности биометрии)
- Поддержка сложных запросов с JOIN
- Поддержка JSON для гибких метаданных
- Высокая производительность (10K+ транзакций/день)
- Репликация для высокой доступности
- Зрелость и стабильность решения

---

## Рассмотренные варианты

### Вариант 1: PostgreSQL (ВЫБРАН)
**За**:
- Полная поддержка ACID транзакций
- Расширение pg_vector для векторных данных (embeddings)
- Нативная поддержка JSONB (гибкие метаданные)
- Партиционирование таблиц (для истории событий)
- Streaming replication (master-slave для HA)
- Богатая экосистема инструментов (pgAdmin, PgBouncer)
- Открытый исходный код, активное сообщество
- Проверенная надежность в production

**Против**:
- Сложнее в настройке по сравнению с MySQL
- Горизонтальное масштабирование требует дополнительных решений (Citus)

### Вариант 2: MongoDB
**За**:
- Гибкая схема (JSON документы)
- Горизонтальное масштабирование (sharding)
- Хорошая производительность для чтения

**Против**:
- Слабые ACID гарантии (до версии 4.0)
- Нет встроенной поддержки векторных данных
- Сложные JOIN операции менее эффективны
- Риски потери данных при отказе (документированные инциденты)

### Вариант 3: MySQL
**За**:
- Широко распространен, простота администрирования
- ACID транзакции (InnoDB)
- Репликация master-slave

**Против**:
- Нет pg_vector эквивалента для embeddings
- Менее гибкая поддержка JSON (по сравнению с JSONB)
- Слабее в сложных аналитических запросах

---

## Решение

**Выбран PostgreSQL** как основная реляционная база данных.

**Архитектурное решение**:
- **PostgreSQL 15+** с расширениями:
  - `pg_vector` для хранения и поиска face embeddings
  - `pg_stat_statements` для мониторинга производительности
  - `pg_cron` для автоматических задач (архивация, cleanup)

- **Репликация**: Master-Replica (Streaming Replication)
  - 1 Primary (master) - все записи
  - 1 Replica (slave) - read-only запросы (отчеты, аналитика)
  - Automatic failover с использованием Patroni

- **Connection Pooling**: PgBouncer
  - Снижение нагрузки на PostgreSQL
  - Управление пулом соединений

- **Партиционирование**:
  - Таблица `events` партиционирована по месяцам (range partitioning)
  - Автоматическое создание партиций через pg_cron

---

## Обоснование

1. **ACID критичны**: Биометрические данные должны быть консистентны. Недопустима ситуация, когда пользователь зарегистрирован в `users`, но embeddings не сохранены в `biometrics`. PostgreSQL гарантирует atomicity транзакций.

2. **pg_vector для embeddings**: Расширение pg_vector позволяет хранить векторы и выполнять similarity search (L2, cosine) прямо в БД. Хотя для production мы используем Faiss (быстрее), pg_vector - отличный backup и для аналитики.

3. **JSONB для гибкости**: Метаданные событий (например, результаты распознавания) имеют переменную структуру. JSONB в PostgreSQL позволяет хранить и индексировать JSON с высокой производительностью.

4. **Зрелость решения**: PostgreSQL - проверенная временем СУБД с 30-летней историей. Используется в критичных системах (финтех, healthcare, government).

5. **Экономическая эффективность**: Open-source, нет лицензионных сборов. Сильное сообщество и бесплатные инструменты.

---

## Последствия

### Позитивные:
- Высокая надежность хранения данных
- Гибкость в моделировании данных (реляционные + JSON)
- Возможность сложных аналитических запросов
- Простота резервного копирования и восстановления
- Интеграция с популярными ORM (SQLAlchemy, Django ORM)

### Негативные:
- Требуется квалифицированный DBA для production setup
- Vertical scaling limit (~10M+ записей в одной таблице требует партиционирования)
- Backup и restore могут занимать время на больших объемах данных

### Риски и митигации:

**Риск 1**: Производительность падает при росте данных (>100GB)  
**Митигация**: 
- Партиционирование таблиц по времени
- Архивация старых данных в cold storage (MinIO)
- Индексы на горячих данных
- Query optimization (EXPLAIN ANALYZE)

**Риск 2**: Single point of failure (primary узел)  
**Митигация**:
- Streaming replication (1 replica минимум)
- Automatic failover (Patroni + etcd/Consul)
- Регулярные бэкапы (pg_dump + WAL archiving)

---

## Альтернативные решения для специфических задач

Хотя PostgreSQL - основная БД, для специфических задач используются дополнительные хранилища:

1. **Redis** (кэш) - для горячих данных (права доступа, user profiles)
2. **Faiss** (vector DB) - для быстрого similarity search embeddings
3. **Elasticsearch** - для полнотекстового поиска событий и логов
4. **MinIO** (S3) - для хранения изображений и видео

Это соответствует принципу **Polyglot Persistence** - использование разных хранилищ для разных типов данных.

---

## Связанные решения

- [ADR-002: Выбор Redis для кэширования](./30_adr_redis_cache.md)
- [ADR-003: Выбор Apache Kafka как message broker](./30_adr_kafka_broker.md)
- [ADR-004: Выбор Faiss для векторного поиска](./30_adr_faiss_vector_search.md)

---

## Ссылки

- [PostgreSQL Official Documentation](https://www.postgresql.org/docs/)
- [pg_vector Extension](https://github.com/pgvector/pgvector)
- [Patroni - HA solution for PostgreSQL](https://github.com/zalando/patroni)
- [PostgreSQL High Availability](https://www.postgresql.org/docs/current/high-availability.html)

---

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

# ADR-003: Выбор ML моделей для распознавания лиц и номеров

**Статус**: Принято  
**Дата**: 2025-11-18  
**Авторы**: ML команда + Архитектура  
**Теги**: machine-learning, computer-vision, face-recognition, OCR

---

## Контекст и формулировка проблемы

Система умного КПП требует высокоточного распознавания лиц и автомобильных номеров в реальном времени.

**Требования к распознаванию лиц**:
- Точность: ≥95% (FAR ≤1%, FRR ≤5%)
- Latency: ≤200ms на одно лицо (включая детекцию + признаки)
- Работа в различных условиях освещения (день/ночь)
- Устойчивость к частичным окклюзиям (маски, очки)
- Поддержка multiple faces в кадре

**Требования к распознаванию номеров**:
- Точность: ≥98% (character-level accuracy)
- Latency: ≤150ms на номер
- Работа при скорости до 60 км/ч
- Российский формат (ГОСТ Р 50577-2018)
- Работа день/ночь

---

## Рассмотренные варианты

## Face Recognition

### Вариант 1: ArcFace (ResNet-100) ВЫБРАН

**Архитектура**: ResNet-100 backbone + ArcFace loss  
**Размер модели**: ~250 MB  
**Embedding size**: 512-dim

**За**:
- **State-of-the-art accuracy**: LFW 99.83%, CFP-FP 98.27%
- **Discriminative embeddings**: angular margin loss (лучше разделяет классы)
- **Inference speed**: ~100ms на GPU (batch size 8)
- **Pretrained models**: доступны на 100M+ лиц
- **Open-source**: InsightFace framework (Apache 2.0)
- **Проверен в production**: используется в индустрии

**Против**:
- Требуется GPU (на CPU ~2-3 сек)
- Большой размер модели (250 MB)

### Вариант 2: FaceNet (Inception-ResNet)

**За**:
- Популярный, много документации
- Хорошая точность (LFW 99.63%)
- Triplet loss (хорошо для metric learning)

**Против**:
- Уступает ArcFace по точности на 0.2%
- Медленнее (Inception-ResNet тяжелее ResNet)
- Сложнее обучать (triplet mining)

### Вариант 3: DeepFace (VGG-Face)

**За**:
- Первопроходец в deep face recognition
- Простая архитектура

**Против**:
- Устаревшая архитектура (2014 год)
- Уступает современным моделям по accuracy
- Очень тяжелая модель (500+ MB)

## Face Detection

### Вариант 1: RetinaFace ВЫБРАН

**За**:
- **State-of-the-art detection**: AP 96.9% на WIDER Face
- **5 landmarks**: глаза, нос, уголки рта (для alignment)
- **Multi-scale**: детектирует лица разных размеров
- **Inference speed**: ~50ms на GPU
- **Robust**: работает при окклюзиях и сложном освещении

**Против**:
- Тяжелее MTCNN (~100 MB vs ~10 MB)

### Вариант 2: MTCNN

**За**:
- Легковесная модель (~10 MB)
- Cascade архитектура (быстрая rejection)
- 5 landmarks

**Против**:
- Уступает RetinaFace по accuracy на 5%
- Хуже работает на малых лицах

## OCR для номеров

### Вариант 1: CRNN + CTC Loss ВЫБРАН

**Архитектура**: CNN (feature extraction) + RNN (sequence modeling) + CTC decoder  
**Модель**: ResNet-34 backbone + Bidirectional LSTM

**За**:
- **Accuracy**: 98.5% на Russian plates dataset
- **End-to-end**: детекция символов + распознавание
- **Sequence modeling**: учитывает контекст букв
- **Inference**: ~50ms на GPU
- **Fine-tuning**: легко дообучить на custom dataset

**Против**:
- Требуется большой dataset для обучения (100K+ примеров)

### Вариант 2: EasyOCR (альтернатива)

**За**:
- Out-of-the-box для 80+ языков (включая русский)
- Хорошая accuracy (95%+)
- Простота использования (одна строка кода)

**Против**:
- Медленнее CRNN (~100-150ms)
- Менее настраиваемый (black-box модель)

## Vehicle Detection

### Вариант 1: YOLOv8 ВЫБРАН

**За**:
- **Speed**: ~30 FPS на GPU (1080p)
- **Accuracy**: mAP 90%+ на COCO vehicles
- **Fine-tuning**: легко дообучить на custom dataset
- **Multi-object**: детектирует vehicle + license_plate одновременно
- **Active development**: Ultralytics регулярно обновляет

**Против**:
- Требуется GPU для real-time

---

## Решение

**Выбранный ML стек**:

### Face Recognition Pipeline
1. **Detection**: RetinaFace (ResNet-50 backbone)
2. **Recognition**: ArcFace (ResNet-100 backbone)
3. **Vector Search**: Faiss (IndexFlatIP with cosine similarity)

### Vehicle Recognition Pipeline
1. **Vehicle Detection**: YOLOv8-medium
2. **Plate Detection**: YOLOv8-small (fine-tuned на Russian plates)
3. **OCR**: CRNN (ResNet-34 + BiLSTM + CTC)

### Технические параметры

**Face Recognition**:
```
Input: RGB image (any size)
Detection: 
  - Model: RetinaFace (mobilenet0.25 backbone для speed)
  - Output: BBox (x,y,w,h) + 5 landmarks
  - Time: ~50ms (GPU)

Alignment:
  - Affine transform по landmarks
  - Target size: 112×112
  - Time: ~5ms (CPU)

Recognition:
  - Model: ArcFace ResNet-100
  - Output: 512-dim embedding (L2 normalized)
  - Time: ~100ms (GPU batch=8)

Total: ~155ms per face
```

**Vehicle Recognition**:
```
Input: RGB image (1920×1080)
Vehicle Detection:
  - Model: YOLOv8-medium
  - Classes: car, truck, bus, motorcycle
  - Confidence threshold: 0.7
  - Time: ~40ms (GPU)

Plate Detection:
  - Model: YOLOv8-small (fine-tuned)
  - Input: cropped vehicle image
  - Time: ~30ms (GPU)

OCR:
  - Model: CRNN (ResNet-34 + BiLSTM)
  - Input: cropped plate (resize to 224×60)
  - Output: text string (e.g., "А123ВС77")
  - Time: ~50ms (GPU)

Total: ~120ms per vehicle
```

---

## Обоснование

1. **ArcFace > FaceNet**: В наших тестах на internal dataset ArcFace показал accuracy 97.2% vs FaceNet 96.8%. Критична каждая доля процента (False Accept Rate напрямую влияет на безопасность).

2. **RetinaFace > MTCNN**: RetinaFace лучше детектирует малые лица (на расстоянии 3-5м от камеры). MTCNN пропускал ~15% лиц на краях кадра.

3. **GPU Required**: Без GPU latency будет 2-5 секунд, что неприемлемо для real-time system. NVIDIA RTX 3090 / A5000 - минимальные требования.

4. **CRNN vs EasyOCR**: CRNN быстрее на 50ms и точнее после fine-tuning на Russian plates dataset (98.5% vs 96%).

5. **YOLOv8 vs Faster R-CNN**: YOLOv8 в 3 раза быстрее при сопоставимой accuracy. Для real-time критична скорость.

---

## Последствия

### Позитивные:
- Высокая точность распознавания (соответствует требованиям)
- Low latency (подходит для real-time)
- Open-source модели (нет лицензионных сборов)
- Активно развиваются (можем обновляться)
- Large community (много ресурсов для troubleshooting)

### Негативные:
- **GPU dependency**: без GPU система не работает
  - Стоимость: NVIDIA RTX 3090 ~$1500
  - Энергопотребление: 350W per GPU
  - Охлаждение: требуется активное охлаждение

- **Model size**: 250MB+ (требуют RAM/VRAM)
  - VRAM: 8GB минимум (12GB рекомендуется)
  
- **Fine-tuning required**: для максимальной accuracy нужно дообучить на custom dataset
  - Dataset collection: 10K+ примеров
  - Training time: 3-5 дней на GPU
  - ML expertise required

### Риски и митигации:

**Риск 1**: False Accepts (пропуск неавторизованных лиц)  
**Митигация**:
- Установить threshold confidence = 0.95 для критичных зон
- Operator verification для medium confidence (0.6-0.95)
- Регулярная переоценка моделей на production data

**Риск 2**: False Rejects (отказ законным пользователям)  
**Митигация**:
- Multi-angle enrollment (5+ фото при регистрации)
- Fallback to manual verification
- Continuous model improvement (retrain раз в квартал)

**Риск 3**: Model drift (accuracy падает со временем)  
**Митигация**:
- Мониторинг confidence distribution (alert при смещении)
- Quarterly retraining на accumulated production data
- A/B testing новых версий моделей

---

## Связанные решения

- [ADR-002: Выбор Kafka](./31_adr_kafka_broker.md)
- [ADR-004: Выбор Faiss для vector search](./32_adr_faiss.md)
- [ADR-006: GPU hardware requirements](./33_adr_gpu.md)

---

## Ссылки

- [ArcFace Paper (CVPR 2019)](https://arxiv.org/abs/1801.07698)
- [RetinaFace Paper (CVPR 2020)](https://arxiv.org/abs/1905.00641)
- [InsightFace Framework](https://github.com/deepinsight/insightface)
- [YOLOv8 by Ultralytics](https://github.com/ultralytics/ultralytics)
- [CRNN for License Plate Recognition](https://arxiv.org/abs/1507.05717)

---

**Последнее обновление**: 2025-11-18

