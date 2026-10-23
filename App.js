import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Platform, StyleSheet, View, BackHandler, Text, ActivityIndicator, Linking } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

// Web app URL - the React SPA
const WEB_URL = 'https://mep-projects.spereon.codes';

let WebView;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').default;
}

// Phone push notifications (owner decision, 21 Oct 2026).
// Show notifications as a banner with sound even while the app is open.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Ask permission and return this phone's Expo push token, or null. */
async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'web') return null;
  try {
    if (Platform.OS === 'android') {
      // Must exist before the token is requested (Android 13+ shows the
      // permission prompt only once a channel exists).
      await Notifications.setNotificationChannelAsync('default', {
        name: 'MEP PROJECTS',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#D92B2B',
      });
    }
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return null;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) return null;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token || null;
  } catch {
    return null; // e.g. no Google Play services: the app still works, just without push
  }
}

/** Page to open for a tapped notification (only paths on our own site). */
function pathFromResponse(response) {
  const path = response?.notification?.request?.content?.data?.path;
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : null;
}

export default function App() {
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const pushTokenRef = useRef(null);
  // If the app was opened by tapping a notification, start on that page.
  const [startUrl] = useState(() => {
    if (Platform.OS === 'web') return WEB_URL;
    try {
      if (typeof Notifications.getLastNotificationResponse !== 'function') return WEB_URL;
      const path = pathFromResponse(Notifications.getLastNotificationResponse());
      return path ? WEB_URL + path : WEB_URL;
    } catch {
      return WEB_URL;
    }
  });

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBackPress = () => {
      if (canGoBack && webViewRef.current) { webViewRef.current.goBack(); return true; }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [canGoBack]);

  // Hand the push token to the website, which registers it for the
  // logged-in user (see new-app/frontend/src/utils/nativePush.js).
  const sendTokenToWeb = useCallback(() => {
    const token = pushTokenRef.current;
    if (!token || !webViewRef.current) return;
    const detail = JSON.stringify({ token, platform: Platform.OS });
    webViewRef.current.injectJavaScript(
      `(function(){window.__mepPushToken=${detail};window.dispatchEvent(new CustomEvent('mep:pushToken',{detail:${detail}}));})();true;`
    );
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    let mounted = true;
    // Older notification library without the synchronous call: fall back.
    if (typeof Notifications.getLastNotificationResponse !== 'function' &&
        typeof Notifications.getLastNotificationResponseAsync === 'function') {
      Notifications.getLastNotificationResponseAsync().then((response) => {
        const path = pathFromResponse(response);
        if (mounted && path && webViewRef.current) {
          webViewRef.current.injectJavaScript(`window.location.assign(${JSON.stringify(WEB_URL + path)});true;`);
        }
      }).catch(() => {});
    }
    registerForPushNotificationsAsync().then((token) => {
      if (!mounted || !token) return;
      pushTokenRef.current = token;
      sendTokenToWeb();
    });
    // Tapping a notification while the app is running opens its page.
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const path = pathFromResponse(response);
      if (path && webViewRef.current) {
        webViewRef.current.injectJavaScript(`window.location.assign(${JSON.stringify(WEB_URL + path)});true;`);
      }
    });
    return () => { mounted = false; sub.remove(); };
  }, [sendTokenToWeb]);

  const onMessage = useCallback((event) => {
    let msg = null;
    try { msg = JSON.parse(event.nativeEvent.data); } catch { return; }
    if (msg && msg.type === 'mep:requestPushToken') sendTokenToWeb();
  }, [sendTokenToWeb]);

  const onLoadEnd = useCallback(() => {
    setLoading(false);
    sendTokenToWeb();
  }, [sendTokenToWeb]);
  const onNavigationStateChange = useCallback((n) => setCanGoBack(n.canGoBack), []);

  const onShouldStartLoadWithRequest = useCallback((request) => {
    const { url } = request;
    // Service report PDFs open in the phone's PDF viewer / browser (a WebView
    // cannot display a PDF).
    if (url.startsWith(WEB_URL + '/api/public/')) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    if (url.startsWith(WEB_URL) || url.startsWith('about:') || url.startsWith('data:')) return true;
    if (url.startsWith('https://wa.me') || url.startsWith('tel:') || url.startsWith('mailto:') ||
        url.startsWith('http')) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  }, []);

  // Links with target="_blank" (PDF, WhatsApp) ask the web view for a new
  // window instead of navigating, which bypasses onShouldStartLoadWithRequest.
  // Route them through the same rules: our pages stay in the app, PDFs and
  // WhatsApp open outside it.
  const onOpenWindow = useCallback((event) => {
    const url = event && event.nativeEvent && event.nativeEvent.targetUrl;
    if (!url) return;
    if (url.startsWith(WEB_URL) && !url.startsWith(WEB_URL + '/api/public/')) {
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(`window.location.assign(${JSON.stringify(url)});true;`);
      }
      return;
    }
    Linking.openURL(url).catch(() => {});
  }, []);

  const injectedJS = `
    (function() {
      var meta = document.querySelector('meta[name="viewport"]');
      if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
      var style = document.createElement('style');
      style.textContent = 'input,select,textarea{font-size:16px !important} body{padding-top:env(safe-area-inset-top)} .app-download{display:none !important}';
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
        source={{ uri: startUrl }}
        style={[styles.webview, loading && { opacity: 0 }]}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onLoadEnd={onLoadEnd}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        setSupportMultipleWindows
        onOpenWindow={onOpenWindow}
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
