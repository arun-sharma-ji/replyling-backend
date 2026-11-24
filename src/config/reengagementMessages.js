// Localized re-engagement pushes for FREE users only (see freeUserFilter in
// pushNotification.service.js). Four steps, sent at most once each, stopping
// after the last: [title, body] per step, indexed by the user's
// reengagementStage (0 => step 1 ... 3 => step 4). Keys match User.appLanguage;
// English is the source and the fallback. Non-English strings are model-drafted:
// have a native speaker skim any locale that matters commercially.
//   1 (3d inactive):  voice-note nudge
//   2 (7d):           feature reminder
//   3 (14d):          try Pro free
//   4 (30d):          last friendly nudge
export const REENGAGEMENT_MESSAGES = {
  en: [
    ["Got a voice note waiting?", "Share it into ReplyLingo and hear it translated in seconds."],
    ["Understand any voice note", "ReplyLingo now translates voice and text in 110 languages."],
    ["Try ReplyLingo Pro free", "Unlimited translations with a free trial. Cancel anytime."],
    ["We miss you 👋", "One tap and your next voice note is translated."],
  ],
  es: [
    ["¿Tienes una nota de voz esperando?", "Compártela en ReplyLingo y escucha la traducción en segundos."],
    ["Entiende cualquier nota de voz", "ReplyLingo ahora traduce voz y texto en 110 idiomas."],
    ["Prueba ReplyLingo Pro gratis", "Traducciones ilimitadas con prueba gratuita. Cancela cuando quieras."],
    ["Te echamos de menos 👋", "Con un toque, tu próxima nota de voz queda traducida."],
  ],
  fr: [
    ["Un message vocal en attente ?", "Partagez-le dans ReplyLingo et écoutez sa traduction en quelques secondes."],
    ["Comprenez n'importe quel message vocal", "ReplyLingo traduit désormais la voix et le texte dans 110 langues."],
    ["Essayez ReplyLingo Pro gratuitement", "Traductions illimitées avec essai gratuit. Annulez à tout moment."],
    ["Vous nous manquez 👋", "Un seul geste et votre prochain message vocal est traduit."],
  ],
  de: [
    ["Wartet eine Sprachnachricht auf dich?", "Teile sie mit ReplyLingo und höre die Übersetzung in Sekunden."],
    ["Verstehe jede Sprachnachricht", "ReplyLingo übersetzt jetzt Sprache und Text in 110 Sprachen."],
    ["ReplyLingo Pro kostenlos testen", "Unbegrenzte Übersetzungen mit kostenloser Testphase. Jederzeit kündbar."],
    ["Wir vermissen dich 👋", "Ein Tipp, und deine nächste Sprachnachricht ist übersetzt."],
  ],
  it: [
    ["Hai un vocale in attesa?", "Condividilo in ReplyLingo e ascolta la traduzione in pochi secondi."],
    ["Capisci qualsiasi vocale", "ReplyLingo ora traduce voce e testo in 110 lingue."],
    ["Prova ReplyLingo Pro gratis", "Traduzioni illimitate con prova gratuita. Annulli quando vuoi."],
    ["Ci manchi 👋", "Un tocco e il tuo prossimo vocale è tradotto."],
  ],
  pt: [
    ["Tem um áudio esperando?", "Compartilhe no ReplyLingo e ouça a tradução em segundos."],
    ["Entenda qualquer áudio", "O ReplyLingo agora traduz voz e texto em 110 idiomas."],
    ["Experimente o ReplyLingo Pro grátis", "Traduções ilimitadas com teste grátis. Cancele quando quiser."],
    ["Sentimos sua falta 👋", "Um toque e seu próximo áudio está traduzido."],
  ],
  nl: [
    ["Wacht er een spraakbericht op je?", "Deel het met ReplyLingo en hoor de vertaling in seconden."],
    ["Begrijp elk spraakbericht", "ReplyLingo vertaalt nu spraak en tekst in 110 talen."],
    ["Probeer ReplyLingo Pro gratis", "Onbeperkt vertalen met gratis proefperiode. Altijd opzegbaar."],
    ["We missen je 👋", "Eén tik en je volgende spraakbericht is vertaald."],
  ],
  pl: [
    ["Czeka na Ciebie wiadomość głosowa?", "Udostępnij ją w ReplyLingo i usłyszysz tłumaczenie w kilka sekund."],
    ["Zrozum każdą wiadomość głosową", "ReplyLingo tłumaczy teraz głos i tekst w 110 językach."],
    ["Wypróbuj ReplyLingo Pro za darmo", "Nielimitowane tłumaczenia z bezpłatnym okresem próbnym. Anuluj w dowolnej chwili."],
    ["Tęsknimy 👋", "Jedno dotknięcie i Twoja następna wiadomość głosowa jest przetłumaczona."],
  ],
  ru: [
    ["Ждёт голосовое сообщение?", "Поделитесь им в ReplyLingo и услышьте перевод за секунды."],
    ["Понимайте любые голосовые", "ReplyLingo теперь переводит голос и текст на 110 языках."],
    ["Попробуйте ReplyLingo Pro бесплатно", "Безлимитные переводы с бесплатным пробным периодом. Отмена в любое время."],
    ["Мы скучаем 👋", "Одно касание — и следующее голосовое переведено."],
  ],
  tr: [
    ["Bekleyen bir sesli mesajınız mı var?", "ReplyLingo'ya paylaşın, çeviriyi saniyeler içinde dinleyin."],
    ["Her sesli mesajı anlayın", "ReplyLingo artık 110 dilde ses ve metin çeviriyor."],
    ["ReplyLingo Pro'yu ücretsiz deneyin", "Ücretsiz denemeyle sınırsız çeviri. İstediğiniz zaman iptal edin."],
    ["Sizi özledik 👋", "Tek dokunuşla bir sonraki sesli mesajınız çevrilsin."],
  ],
  id: [
    ["Ada pesan suara yang menunggu?", "Bagikan ke ReplyLingo dan dengarkan terjemahannya dalam hitungan detik."],
    ["Pahami pesan suara apa pun", "ReplyLingo kini menerjemahkan suara dan teks dalam 110 bahasa."],
    ["Coba ReplyLingo Pro gratis", "Terjemahan tanpa batas dengan uji coba gratis. Batalkan kapan saja."],
    ["Kami merindukanmu 👋", "Sekali ketuk, pesan suara berikutnya langsung diterjemahkan."],
  ],
  ja: [
    ["ボイスメッセージが届いていませんか？", "ReplyLingoに共有すれば、数秒で翻訳音声が聞けます。"],
    ["どんなボイスメッセージも理解", "ReplyLingoは110言語の音声とテキスト翻訳に対応しました。"],
    ["ReplyLingo Proを無料で試す", "無料トライアルで翻訳し放題。いつでもキャンセルできます。"],
    ["お待ちしています 👋", "ワンタップで次のボイスメッセージを翻訳できます。"],
  ],
  ko: [
    ["기다리는 음성 메시지가 있나요?", "ReplyLingo로 공유하면 몇 초 만에 번역을 들을 수 있어요."],
    ["어떤 음성 메시지든 이해하세요", "ReplyLingo가 이제 110개 언어의 음성과 텍스트를 번역해요."],
    ["ReplyLingo Pro 무료 체험", "무료 체험으로 무제한 번역. 언제든 취소할 수 있어요."],
    ["보고 싶었어요 👋", "한 번의 탭으로 다음 음성 메시지를 번역해 보세요."],
  ],
  zh: [
    ["有语音消息等着你吗？", "分享到 ReplyLingo，几秒钟就能听到翻译。"],
    ["听懂任何语音消息", "ReplyLingo 现已支持 110 种语言的语音和文字翻译。"],
    ["免费试用 ReplyLingo Pro", "免费试用，无限翻译。可随时取消。"],
    ["我们想你了 👋", "轻轻一点，下一条语音消息就能翻译。"],
  ],
  ar: [
    ["هل لديك رسالة صوتية تنتظرك؟", "شاركها في ReplyLingo واستمع إلى ترجمتها في ثوانٍ."],
    ["افهم أي رسالة صوتية", "يترجم ReplyLingo الآن الصوت والنص بـ 110 لغة."],
    ["جرّب ReplyLingo Pro مجانًا", "ترجمات غير محدودة مع فترة تجريبية مجانية. ألغِ في أي وقت."],
    ["نفتقدك 👋", "بنقرة واحدة تُترجم رسالتك الصوتية التالية."],
  ],
  fa: [
    ["پیام صوتی منتظرتان است؟", "آن را در ReplyLingo به اشتراک بگذارید و ترجمه‌اش را در چند ثانیه بشنوید."],
    ["هر پیام صوتی را بفهمید", "ReplyLingo اکنون صدا و متن را در ۱۱۰ زبان ترجمه می‌کند."],
    ["ReplyLingo Pro را رایگان امتحان کنید", "ترجمه نامحدود با دوره آزمایشی رایگان. هر زمان لغو کنید."],
    ["دلتنگتان شدیم 👋", "با یک ضربه، پیام صوتی بعدی‌تان ترجمه می‌شود."],
  ],
  ur: [
    ["کیا کوئی وائس نوٹ انتظار میں ہے؟", "اسے ReplyLingo میں شیئر کریں اور سیکنڈوں میں ترجمہ سنیں۔"],
    ["کوئی بھی وائس نوٹ سمجھیں", "ReplyLingo اب 110 زبانوں میں آواز اور متن کا ترجمہ کرتا ہے۔"],
    ["ReplyLingo Pro مفت آزمائیں", "مفت ٹرائل کے ساتھ لامحدود تراجم۔ جب چاہیں منسوخ کریں۔"],
    ["ہمیں آپ کی یاد آتی ہے 👋", "ایک ٹیپ اور آپ کا اگلا وائس نوٹ ترجمہ ہو جائے۔"],
  ],
  hi: [
    ["कोई वॉइस नोट इंतज़ार में है?", "उसे ReplyLingo में शेयर करें और सेकंडों में अनुवाद सुनें।"],
    ["कोई भी वॉइस नोट समझें", "ReplyLingo अब 110 भाषाओं में आवाज़ और टेक्स्ट का अनुवाद करता है।"],
    ["ReplyLingo Pro मुफ़्त आज़माएँ", "मुफ़्त ट्रायल के साथ असीमित अनुवाद। कभी भी रद्द करें।"],
    ["हमें आपकी याद आती है 👋", "एक टैप में आपका अगला वॉइस नोट अनुवादित।"],
  ],
  bn: [
    ["কোনো ভয়েস নোট অপেক্ষা করছে?", "ReplyLingo-তে শেয়ার করুন এবং কয়েক সেকেন্ডে অনুবাদ শুনুন।"],
    ["যেকোনো ভয়েস নোট বুঝুন", "ReplyLingo এখন ১১০টি ভাষায় ভয়েস ও টেক্সট অনুবাদ করে।"],
    ["ReplyLingo Pro বিনামূল্যে চেষ্টা করুন", "বিনামূল্যের ট্রায়ালসহ সীমাহীন অনুবাদ। যেকোনো সময় বাতিল করুন।"],
    ["আমরা আপনাকে মিস করছি 👋", "এক ট্যাপেই আপনার পরের ভয়েস নোট অনুবাদ হয়ে যাবে।"],
  ],
  pa: [
    ["ਕੋਈ ਵੌਇਸ ਨੋਟ ਉਡੀਕ ਕਰ ਰਿਹਾ ਹੈ?", "ਇਸਨੂੰ ReplyLingo ਵਿੱਚ ਸਾਂਝਾ ਕਰੋ ਅਤੇ ਕੁਝ ਸਕਿੰਟਾਂ ਵਿੱਚ ਅਨੁਵਾਦ ਸੁਣੋ।"],
    ["ਕੋਈ ਵੀ ਵੌਇਸ ਨੋਟ ਸਮਝੋ", "ReplyLingo ਹੁਣ 110 ਭਾਸ਼ਾਵਾਂ ਵਿੱਚ ਆਵਾਜ਼ ਅਤੇ ਟੈਕਸਟ ਦਾ ਅਨੁਵਾਦ ਕਰਦਾ ਹੈ।"],
    ["ReplyLingo Pro ਮੁਫ਼ਤ ਅਜ਼ਮਾਓ", "ਮੁਫ਼ਤ ਟ੍ਰਾਇਲ ਨਾਲ ਅਸੀਮਿਤ ਅਨੁਵਾਦ। ਕਦੇ ਵੀ ਰੱਦ ਕਰੋ।"],
    ["ਸਾਨੂੰ ਤੁਹਾਡੀ ਯਾਦ ਆਉਂਦੀ ਹੈ 👋", "ਇੱਕ ਟੈਪ ਨਾਲ ਤੁਹਾਡਾ ਅਗਲਾ ਵੌਇਸ ਨੋਟ ਅਨੁਵਾਦ ਹੋ ਜਾਵੇਗਾ।"],
  ],
};

export const REENGAGEMENT_STEPS = 4;
