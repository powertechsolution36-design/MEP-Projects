import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  BackHandler,
  Text,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import htmlContent from './htmlContent';

let WebView;
if (Platform.OS !== 'web') {
  WebView = require('react-native-webview').default;
}

export default function App() {
  const webViewRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);

  // Handle Android hardware back button
  useEffect(() => {
    if (Platform.OS === 'android') {
      const onBackPress = () => {
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }
  }, [canGoBack]);

  const onLoadEnd = useCallback(() => {
    setLoading(false);
  }, []);

  const onNavigationStateChange = useCallback((navState) => {
    setCanGoBack(navState.canGoBack);
  }, []);

  // Handle external links (WhatsApp, tel:, mailto:, etc)
  const onShouldStartLoadWithRequest = useCallback((request) => {
    const { url } = request;
    // Allow the initial HTML and about:blank (for window.open print)
    if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('about:srcdoc')) {
      return true;
    }
    // Open external URLs in device browser
    if (url.startsWith('https://wa.me') || url.startsWith('tel:') || url.startsWith('mailto:') || url.startsWith('https://') || url.startsWith('http://')) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  }, []);

  // Injected JS to improve mobile native app experience
  const injectedJS = `
    (function() {
      // Ensure viewport meta is set correctly
      var meta = document.querySelector('meta[name="viewport"]');
      if (meta) {
        meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
      }

      // Hide PWA install bar since we're already a native app
      var instbar = document.getElementById('instbar');
      if (instbar) instbar.style.display = 'none';
      var loginInstall = document.getElementById('loginInstall');
      if (loginInstall) loginInstall.style.display = 'none';

      // Override pwaShowInstall to prevent it from showing
      window.pwaShowInstall = function() {};
      window.pwaInstall = function() {};

      // Make inputs 16px to prevent iOS zoom
      var style = document.createElement('style');
      style.textContent =
        'input, select, textarea { font-size: 16px !important; }' +
        '#login { padding-top: env(safe-area-inset-top); }';
      document.head.appendChild(style);

      // Override window.open for print - use postMessage to trigger native print
      var origOpen = window.open;
      window.open = function(url, target) {
        if (url === '' && target === '_blank') {
          // This is for printing - create a hidden iframe instead
          var iframe = document.createElement('iframe');
          iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#fff;border:none;';
          document.body.appendChild(iframe);
          var doc = iframe.contentDocument || iframe.contentWindow.document;
          // Add a close button
          var closeBtn = document.createElement('div');
          closeBtn.innerHTML = '<button onclick="this.parentElement.parentElement.remove()" style="position:fixed;top:10px;right:10px;z-index:10000;background:#d92b2b;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:16px;font-weight:700;cursor:pointer;">✕ Close</button>';
          iframe.contentDocument.body.appendChild = (function(origAppend) {
            return function(el) { return origAppend.call(this, el); };
          })(iframe.contentDocument.body.appendChild);
          return {
            document: {
              write: function(h) { doc.open(); doc.write(h); },
              close: function() {
                doc.close();
                // Add close button to the iframe content
                var btn = doc.createElement('button');
                btn.textContent = '✕ Close Preview';
                btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:10000;background:#d92b2b;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:16px;font-weight:700;cursor:pointer;';
                btn.onclick = function() { iframe.remove(); };
                doc.body.appendChild(btn);
              }
            },
            print: function() {
              // On native, just show the preview with close button
            },
            close: function() { iframe.remove(); }
          };
        }
        return origOpen ? origOpen.apply(this, arguments) : null;
      };

      true;
    })();
  `;

  // ---------- WEB ----------
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <iframe
          srcDoc={htmlContent}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
          title="MEP PROJECTS"
          allow="clipboard-write"
        />
      </View>
    );
  }

  // ---------- NATIVE (Android / iOS) ----------
  return (
    <View style={styles.container}>
      <ExpoStatusBar style="light" backgroundColor="#16202e" translucent={false} />
      {loading && (
        <View style={styles.loader}>
          <Text style={styles.loaderBrand}>MEP</Text>
          <Text style={styles.loaderBrandSub}>PROJECTS</Text>
          <ActivityIndicator size="large" color="#d92b2b" style={{ marginTop: 20 }} />
          <Text style={styles.loaderText}>Loading app...</Text>
        </View>
      )}
      <WebView
        ref={webViewRef}
        source={{ html: htmlContent, baseUrl: '' }}
        style={[styles.webview, loading && { opacity: 0 }]}
        originWhitelist={['*']}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={false}
        onLoadEnd={onLoadEnd}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        injectedJavaScript={injectedJS}
        allowsBackForwardNavigationGestures={true}
        allowsInlineMediaPlayback={true}
        mixedContentMode="compatibility"
        textZoom={100}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        cacheEnabled={true}
        thirdPartyCookiesEnabled={true}
        allowFileAccess={true}
        allowFileAccessFromFileURLs={true}
        allowUniversalAccessFromFileURLs={true}
        mediaPlaybackRequiresUserAction={false}
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#16202e',
  },
  webview: {
    flex: 1,
    backgroundColor: '#f2f4f8',
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#16202e',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  loaderBrand: {
    fontSize: 40,
    fontWeight: '800',
    color: '#d92b2b',
    letterSpacing: 2,
  },
  loaderBrandSub: {
    fontSize: 40,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 2,
    marginTop: -4,
  },
  loaderText: {
    color: '#7e8ea0',
    marginTop: 16,
    fontSize: 14,
  },
});
