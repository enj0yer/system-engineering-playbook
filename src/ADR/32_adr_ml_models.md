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
