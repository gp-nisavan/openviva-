
import json
with open('/home/savan/openviva/models/whisper/large-v3-turbo/tokenizer.json') as f:
    data = json.load(f)
vocab = data['model']['vocab']
print('kn in vocab:', '<|kn|>' in vocab)
print('kannada token:', vocab.get('<|kn|>'))
