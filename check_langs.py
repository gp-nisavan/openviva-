
from faster_whisper.tokenizer import _LANGUAGE_CODES
print('Total languages:', len(_LANGUAGE_CODES))
print('kn in _LANGUAGE_CODES:', 'kn' in _LANGUAGE_CODES)
indian_langs = [l for l in ['hi', 'kn', 'ta', 'te', 'ml', 'mr', 'gu', 'bn', 'pa', 'ur', 'sa'] if l in _LANGUAGE_CODES]
print('Supported Indian languages:', indian_langs)
