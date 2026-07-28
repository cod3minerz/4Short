export const navigation = [
  { label: "Возможности", href: "#features" },
  { label: "Тарифы", href: "#pricing" },
  { label: "Минуты", href: "#minutes" },
  { label: "FAQ", href: "#faq" },
] as const;

export type PricingPlan = {
  id: "start" | "creator" | "studio";
  name: string;
  description: string;
  minutes: number;
  monthly: number;
  cta: string;
  popular?: boolean;
  features: readonly string[];
};

export const pricingPlans: readonly PricingPlan[] = [
  {
    id: "start",
    name: "Start",
    description: "Для первого проекта и нерегулярных выпусков.",
    minutes: 120,
    monthly: 990,
    cta: "Начать со Start",
    features: [
      "Поиск сильных моментов",
      "Автоматические субтитры",
      "Трекинг активного спикера",
      "Экспорт вертикального видео",
    ],
  },
  {
    id: "creator",
    name: "Creator",
    description: "Для регулярного выпуска короткого контента.",
    minutes: 300,
    monthly: 2490,
    cta: "Выбрать Creator",
    popular: true,
    features: [
      "Всё из тарифа Start",
      "Удаление пауз",
      "Настройка количества и длины",
      "Сохранённые стили",
      "Приоритетная обработка",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    description: "Для команд, клиентов и нескольких проектов.",
    minutes: 900,
    monthly: 5990,
    cta: "Выбрать Studio",
    features: [
      "Всё из тарифа Creator",
      "Пакетная обработка",
      "Бренд-пресеты",
      "Доступ для команды",
      "Расширенное хранение",
    ],
  },
] as const;

export type MinutePackage = {
  minutes: number;
  price: number;
  featured?: boolean;
};

export const minutePackages: readonly MinutePackage[] = [
  { minutes: 60, price: 590 },
  { minutes: 180, price: 1490, featured: true },
  { minutes: 360, price: 2690 },
] as const;

export const faqItems = [
  {
    question: "Какие видео можно загружать?",
    answer:
      "Можно добавить видеофайл или ссылку на YouTube. Финальные ограничения по размеру и формату будут показаны непосредственно перед загрузкой.",
  },
  {
    question: "Как списываются минуты?",
    answer:
      "Минуты считаются по длительности исходного видео, а не по суммарной длине получившихся клипов.",
  },
  {
    question: "Сколько клипов получится из одного видео?",
    answer:
      "Количество зависит от исходника и выбранных настроек. Вы сможете задать нужное число клипов и диапазон длительности.",
  },
  {
    question: "Можно ли изменить выбранные моменты?",
    answer:
      "Да. Перед экспортом можно проверить найденные моменты и скорректировать результат.",
  },
  {
    question: "Можно ли исправить субтитры?",
    answer:
      "Да. Текст субтитров можно отредактировать до экспорта ролика.",
  },
  {
    question: "Будет ли водяной знак?",
    answer:
      "Условия экспорта зависят от тарифа и будут явно показаны перед оплатой.",
  },
  {
    question: "Сколько времени хранится проект?",
    answer:
      "Срок хранения зависит от тарифа. Точный период будет указан в кабинете и перед оплатой.",
  },
  {
    question: "Что происходит с загруженными видео?",
    answer:
      "Правила обработки, хранения и удаления файлов будут зафиксированы в политике конфиденциальности.",
  },
  {
    question: "Как работают дополнительные минуты?",
    answer:
      "Разовый пакет добавляется к текущему балансу и не меняет ваш основной тариф.",
  },
  {
    question: "Можно ли отменить подписку?",
    answer:
      "Да. Управление подпиской будет доступно в кабинете. Условия списания показываются до подтверждения оплаты.",
  },
] as const;
