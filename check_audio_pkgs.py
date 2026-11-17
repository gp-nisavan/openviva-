
import sys
for pkg in ['pydub', 'soundfile', 'scipy', 'torchaudio', 'av', 'ffmpeg', 'imageio_ffmpeg']:
    try:
        mod = __import__(pkg)
        print(pkg, 'INSTALLED', getattr(mod, '__file__', ''))
    except Exception as e:
        print(pkg, 'NOT_INSTALLED:', e)
