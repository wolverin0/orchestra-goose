"""Append GOOSE_MOIM_MESSAGE_FILE to goose config.yaml so the tom extension picks up the briefing."""
import os
config_path = os.path.join(os.environ['APPDATA'], 'Block', 'goose', 'config', 'config.yaml')
tom_path = os.path.join(os.environ['USERPROFILE'], '.orchestra-goose', 'tom-message.txt')
tom_path_yaml = tom_path.replace(os.sep, '/')

with open(config_path, 'r', encoding='utf-8') as f:
    text = f.read()

if 'GOOSE_MOIM_MESSAGE_FILE' in text:
    print('already configured')
else:
    addition = '\nGOOSE_MOIM_MESSAGE_FILE: "' + tom_path_yaml + '"\n'
    with open(config_path, 'a', encoding='utf-8') as f:
        f.write(addition)
    print('appended to config.yaml')

# Show last 5 lines
with open(config_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()
for line in lines[-6:]:
    print(line.rstrip())
