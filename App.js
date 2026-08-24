import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Platform, StyleSheet, View, BackHandler, Text, ActivityIndicator, Linking } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

// Web app URL - the React SPA
const WEB_URL = 'https://mep-projects.spereon.codes';

let WebView;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').default;
}

export default function App() {
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBackPress = () => {
      if (canGoBack && webViewRef.current) { webViewRef.current.goBack(); return true; }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [canGoBack]);

  const onLoadEnd = useCallback(() => setLoading(false), []);
  const onNavigationStateChange = useCallback((n) => setCanGoBack(n.canGoBack), []);

  const onShouldStartLoadWithRequest = useCallback((request) => {
    const { url } = request;
    if (url.startsWith(WEB_URL) || url.startsWith('about:') || url.startsWith('data:')) return true;
    if (url.startsWith('https://wa.me') || url.startsWith('tel:') || url.startsWith('mailto:') ||
        url.startsWith('http')) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  }, []);

  const injectedJS = `
    (function() {
      var meta = document.querySelector('meta[name="viewport"]');
      if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
      var style = document.createElement('style');
      style.textContent = 'input,select,textarea{font-size:16px !important} body{padding-top:env(safe-area-inset-top)}';
      document.head.appendChild(style);
      true;
    })();
  `;

  if (Platform.OS === 'web') {
    return <View style={styles.container}><iframe src={WEB_URL} style={{ width: '100%', height: '100%', border: 'none' }} title="MEP PROJECTS" /></View>;
  }

  return (
    <View style={styles.container}>
      <ExpoStatusBar style="light" backgroundColor="#16202e" translucent={false} />
      {loading && (
        <View style={styles.loader}>
          <Text style={styles.brand}>MEP</Text>
          <Text style={styles.brandSub}>PROJECTS</Text>
          <ActivityIndicator size="large" color="#d92b2b" style={{ marginTop: 20 }} />
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ uri: WEB_URL }}
        style={[styles.webview, loading && { opacity: 0 }]}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onLoadEnd={onLoadEnd}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        injectedJavaScript={injectedJS}
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        cacheEnabled
        thirdPartyCookiesEnabled
        mediaPlaybackRequiresUserAction={false}
        keyboardDisplayRequiresUserAction={false}
        showsVerticalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#16202e' },
  webview: { flex: 1, backgroundColor: '#f2f4f8' },
  loader: { ...StyleSheet.absoluteFillObject, backgroundColor: '#16202e', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  brand: { fontSize: 40, fontWeight: '800', color: '#d92b2b', letterSpacing: 2 },
  brandSub: { fontSize: 40, fontWeight: '800', color: '#fff', letterSpacing: 2, marginTop: -4 },
});
