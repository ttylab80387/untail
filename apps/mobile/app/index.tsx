import { DEFAULT_USER_AGENT } from '@linkclean/core';
import { Text, View } from 'react-native';

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>LinkClean ({DEFAULT_USER_AGENT})</Text>
    </View>
  );
}
