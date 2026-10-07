import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ResultCard } from '../src/components/ResultCard';
import { useApp } from '../src/state/AppContext';
import { useColors } from '../src/theme';

export default function Home() {
  const { t } = useTranslation();
  const c = useColors();
  const { ready, input, setInput, busy, outcome, submit } = useApp();
  const canClean = ready && !busy && input.trim().length > 0;

  const pasteFallback = async () => setInput(await Clipboard.getStringAsync());

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder={t('home.placeholder')}
        placeholderTextColor={c.muted}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
      />
      <View style={styles.row}>
        {Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable ? (
          <Clipboard.ClipboardPasteButton
            onPress={(data) => {
              if (data.type === 'text') setInput(data.text);
            }}
            acceptedContentTypes={['plain-text', 'url']}
            displayMode="iconAndLabel"
            style={styles.pasteButton}
          />
        ) : (
          <Pressable onPress={() => void pasteFallback()} style={[styles.button, { borderColor: c.accent, borderWidth: 1 }]}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>{t('home.paste')}</Text>
          </Pressable>
        )}
        <Pressable
          disabled={!canClean}
          onPress={() => void submit(input)}
          style={[styles.button, { backgroundColor: c.accent, opacity: canClean ? 1 : 0.5 }]}
        >
          <Text style={styles.buttonText}>{busy ? t('home.cleaning') : t('home.clean')}</Text>
        </Pressable>
      </View>
      {(busy || !ready) && <ActivityIndicator />}
      {outcome && !busy && <ResultCard result={outcome.result} copied={outcome.copied} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  input: { minHeight: 96, borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 15, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  button: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  buttonText: { color: '#ffffff', fontWeight: '600' },
  pasteButton: { width: 120, height: 40 },
});
