import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { HowTo } from '../src/components/HowTo';
import { ResultCard } from '../src/components/ResultCard';
import { useApp } from '../src/state/AppContext';
import { MONO, useColors } from '../src/theme';
import { useBottomPadding } from '../src/bottomPadding';

export default function Home() {
  const bottomPadding = useBottomPadding();
  const { t } = useTranslation();
  const c = useColors();
  const {
    ready,
    input,
    setInput,
    busy,
    outcome,
    submit,
    clipboardOffer,
    acceptClipboardOffer,
    dismissClipboardOffer,
    autoCleaned,
    clipboardHasCleanLink,
    undoAutoClean,
    dismissAutoClean,
    dismissCleanLinkNotice,
  } = useApp();
  const canClean = ready && !busy && input.trim().length > 0;

  const pasteFallback = async () => setInput(await Clipboard.getStringAsync());

  return (
    <ScrollView contentContainerStyle={[styles.container, bottomPadding]} keyboardShouldPersistTaps="handled">
      {clipboardHasCleanLink && !clipboardOffer && !autoCleaned && !busy && (
        <Notice icon="checkmark-circle" text={t('home.clipboardNoTracking')}>
          <TextButton label={t('home.dismiss')} onPress={dismissCleanLinkNotice} muted />
        </Notice>
      )}
      {autoCleaned && !busy && (
        <Notice icon="checkmark-circle" text={t('home.autoCleaned')}>
          <TextButton label={t('home.undo')} onPress={undoAutoClean} />
          <TextButton label={t('home.dismiss')} onPress={dismissAutoClean} muted />
        </Notice>
      )}
      {autoCleaned && !busy && Platform.OS === 'ios' && (
        // iOS asks before every automatic read unless the user allows pasting for Untail in Settings.
        <View style={styles.iosHint}>
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>{t('home.iosPasteHint')}</Text>
          <TextButton label={t('home.openSettings')} onPress={() => void Linking.openSettings()} />
        </View>
      )}
      {clipboardOffer && !busy && (
        <Notice icon="clipboard-outline" text={t('home.clipboardOffer')}>
          {clipboardOffer.kind === 'ios' && Clipboard.isPasteButtonAvailable ? (
            // The system paste button reads the clipboard without the "Allow Paste" prompt.
            <Clipboard.ClipboardPasteButton
              onPress={(data) => {
                if (data.type === 'text') acceptClipboardOffer(data.text);
              }}
              acceptedContentTypes={['plain-text', 'url']}
              displayMode="iconAndLabel"
              backgroundColor={c.card}
              foregroundColor={c.text}
              cornerStyle="medium"
              style={styles.pasteButton}
            />
          ) : (
            <TextButton
              label={t('home.clipboardClean')}
              onPress={async () => acceptClipboardOffer(clipboardOffer.kind === 'ios' ? await Clipboard.getStringAsync() : undefined)}
            />
          )}
          <TextButton label={t('home.dismiss')} onPress={dismissClipboardOffer} muted />
        </Notice>
      )}
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder={t('home.placeholder')}
        placeholderTextColor={c.muted}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { color: c.text, backgroundColor: c.card }]}
      />
      <View style={styles.row}>
        {Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable ? (
          <Clipboard.ClipboardPasteButton
            onPress={(data) => {
              if (data.type === 'text') setInput(data.text);
            }}
            acceptedContentTypes={['plain-text', 'url']}
            displayMode="iconAndLabel"
            backgroundColor={c.card}
            foregroundColor={c.text}
            cornerStyle="medium"
            style={styles.pasteButton}
          />
        ) : (
          <Pressable onPress={() => void pasteFallback()} style={[styles.button, styles.outline, { borderColor: c.border }]}>
            <Ionicons name="clipboard-outline" size={16} color={c.text} />
            <Text style={{ color: c.text, fontWeight: '600' }}>{t('home.paste')}</Text>
          </Pressable>
        )}
        <Pressable
          disabled={!canClean}
          onPress={() => void submit(input)}
          style={[styles.button, styles.primary, { backgroundColor: c.accent, opacity: canClean ? 1 : 0.4 }]}
        >
          <Text style={[styles.primaryText, { color: c.onAccent }]}>{busy ? t('home.cleaning') : `${t('home.clean')} →`}</Text>
        </Pressable>
      </View>
      {(busy || !ready) && <ActivityIndicator color={c.accent} />}
      {outcome && !busy && <ResultCard result={outcome.result} copied={outcome.copied} />}
      {!outcome && !busy && ready && <HowTo />}
    </ScrollView>
  );
}

// Outlined notice row used for every clipboard message.
function Notice({ icon, text, children }: { icon: keyof typeof Ionicons.glyphMap; text: string; children: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.notice, { borderColor: c.border }]}>
      <View style={styles.noticeHead}>
        <Ionicons name={icon} size={18} color={c.accent} />
        <Text style={[styles.noticeText, { color: c.text }]}>{text}</Text>
      </View>
      <View style={styles.noticeActions}>{children}</View>
    </View>
  );
}

function TextButton({ label, onPress, muted }: { label: string; onPress(): void; muted?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={{ color: muted ? c.muted : c.accent, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  input: { minHeight: 96, borderRadius: 12, padding: 14, fontSize: 14, fontFamily: MONO, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  outline: { borderWidth: 1 },
  primary: { flex: 1 },
  primaryText: { fontWeight: '800', fontSize: 15 },
  pasteButton: { width: 120, height: 44 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  noticeHead: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontWeight: '600', lineHeight: 20 },
  iosHint: { gap: 6, paddingHorizontal: 4, marginTop: -4 },
  noticeActions: { flexDirection: 'row', gap: 20, alignItems: 'center', paddingLeft: 26 },
});
