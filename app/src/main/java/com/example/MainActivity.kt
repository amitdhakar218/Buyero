package com.example

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.os.Bundle
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.webkit.WebViewAssetLoader
import com.example.ui.theme.BuyeroDeepNavy
import com.example.ui.theme.BuyeroNavy
import com.example.ui.theme.BuyeroOrange
import com.example.ui.theme.BuyeroTeal
import com.example.ui.theme.MyApplicationTheme

enum class BuyeroAppMode(val title: String, val assetUrl: String) {
  CLIENT("Client Store", "https://buyero-68abd.firebaseapp.com/assets/client/index.html"),
  ADMIN("Admin Studio", "https://buyero-68abd.firebaseapp.com/assets/admin/index.html")
}

class MainActivity : ComponentActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()

    setContent {
      MyApplicationTheme {
        BuyeroHostScreen()
      }
    }
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BuyeroHostScreen() {
  var currentMode by remember { mutableStateOf(BuyeroAppMode.CLIENT) }
  var webViewInstance by remember { mutableStateOf<WebView?>(null) }
  var pageProgress by remember { mutableFloatStateOf(0f) }
  var isLoading by remember { mutableStateOf(true) }
  var showInfoDialog by remember { mutableStateOf(false) }

  // Handle system back navigation inside WebView
  BackHandler(enabled = webViewInstance?.canGoBack() == true) {
    webViewInstance?.goBack()
  }

  Scaffold(
    modifier = Modifier
      .fillMaxSize()
      .testTag("buyero_scaffold"),
    topBar = {
      Surface(
        color = BuyeroNavy,
        shadowElevation = 4.dp,
        modifier = Modifier
          .fillMaxWidth()
          .testTag("buyero_top_bar")
      ) {
        Column(
          modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
          ) {
            // Dual App Mode Segmented Switcher
            Row(
              modifier = Modifier
                .clip(RoundedCornerShape(20.dp))
                .background(BuyeroDeepNavy)
                .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(20.dp))
                .padding(3.dp),
              verticalAlignment = Alignment.CenterVertically
            ) {
              // Mode 1: Client Store
              val clientSelected = currentMode == BuyeroAppMode.CLIENT
              Box(
                modifier = Modifier
                  .clip(RoundedCornerShape(16.dp))
                  .background(if (clientSelected) BuyeroOrange else Color.Transparent)
                  .clickable {
                    if (currentMode != BuyeroAppMode.CLIENT) {
                      currentMode = BuyeroAppMode.CLIENT
                      webViewInstance?.loadUrl(BuyeroAppMode.CLIENT.assetUrl)
                    }
                  }
                  .padding(horizontal = 12.dp, vertical = 6.dp)
                  .testTag("tab_client_store"),
                contentAlignment = Alignment.Center
              ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                  Icon(
                    imageVector = Icons.Default.ShoppingBag,
                    contentDescription = "Client Store",
                    tint = if (clientSelected) Color.White else Color(0xFF94A3B8),
                    modifier = Modifier.size(14.dp)
                  )
                  Spacer(modifier = Modifier.width(4.dp))
                  Text(
                    text = "Client Store",
                    color = if (clientSelected) Color.White else Color(0xFFCBD5E1),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold
                  )
                }
              }

              // Mode 2: Admin Studio
              val adminSelected = currentMode == BuyeroAppMode.ADMIN
              Box(
                modifier = Modifier
                  .clip(RoundedCornerShape(16.dp))
                  .background(if (adminSelected) BuyeroTeal else Color.Transparent)
                  .clickable {
                    if (currentMode != BuyeroAppMode.ADMIN) {
                      currentMode = BuyeroAppMode.ADMIN
                      webViewInstance?.loadUrl(BuyeroAppMode.ADMIN.assetUrl)
                    }
                  }
                  .padding(horizontal = 12.dp, vertical = 6.dp)
                  .testTag("tab_admin_studio"),
                contentAlignment = Alignment.Center
              ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                  Icon(
                    imageVector = Icons.Default.Tune,
                    contentDescription = "Admin Studio",
                    tint = if (adminSelected) BuyeroDeepNavy else Color(0xFF94A3B8),
                    modifier = Modifier.size(14.dp)
                  )
                  Spacer(modifier = Modifier.width(4.dp))
                  Text(
                    text = "Admin Studio",
                    color = if (adminSelected) BuyeroDeepNavy else Color(0xFFCBD5E1),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold
                  )
                }
              }
            }

            // Action Icons (Refresh & Info)
            Row(verticalAlignment = Alignment.CenterVertically) {
              IconButton(
                onClick = { webViewInstance?.reload() },
                modifier = Modifier.size(36.dp).testTag("btn_refresh")
              ) {
                Icon(
                  imageVector = Icons.Default.Refresh,
                  contentDescription = "Reload Page",
                  tint = Color.White,
                  modifier = Modifier.size(18.dp)
                )
              }

              IconButton(
                onClick = { showInfoDialog = true },
                modifier = Modifier.size(36.dp).testTag("btn_info")
              ) {
                Icon(
                  imageVector = Icons.Default.Info,
                  contentDescription = "App Architecture Info",
                  tint = BuyeroOrange,
                  modifier = Modifier.size(18.dp)
                )
              }
            }
          }

          // Page loading bar
          AnimatedVisibility(
            visible = isLoading && pageProgress < 1f,
            enter = fadeIn(),
            exit = fadeOut()
          ) {
            LinearProgressIndicator(
              progress = { pageProgress },
              modifier = Modifier
                .fillMaxWidth()
                .height(2.dp)
                .padding(top = 4.dp),
              color = BuyeroOrange,
              trackColor = Color.White.copy(alpha = 0.2f)
            )
          }
        }
      }
    }
  ) { innerPadding ->
    Box(
      modifier = Modifier
        .fillMaxSize()
        .padding(innerPadding)
    ) {
      AndroidView(
        modifier = Modifier
          .fillMaxSize()
          .testTag("buyero_webview"),
        factory = { context ->
          WebView(context).apply {
            val defaultUa = settings.userAgentString
            settings.apply {
              javaScriptEnabled = true
              domStorageEnabled = true
              databaseEnabled = true
              allowFileAccess = true
              allowContentAccess = true
              useWideViewPort = true
              loadWithOverviewMode = true
              mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
              cacheMode = WebSettings.LOAD_DEFAULT
              javaScriptCanOpenWindowsAutomatically = true
              setSupportMultipleWindows(true)
              userAgentString = defaultUa.replace("; wv", "").replace("Version/4.0 ", "")
            }

            val currentWebView = this
            val assetLoader = WebViewAssetLoader.Builder()
              .setDomain("buyero-68abd.firebaseapp.com")
              .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
              .build()

            android.webkit.CookieManager.getInstance().setAcceptCookie(true)
            android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(currentWebView, true)

            webChromeClient = object : WebChromeClient() {
              override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: android.os.Message?
              ): Boolean {
                val popupDialog = android.app.Dialog(context, android.R.style.Theme_DeviceDefault_Light_NoActionBar)
                val newWebView = WebView(context).apply {
                  settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    databaseEnabled = true
                    useWideViewPort = true
                    loadWithOverviewMode = true
                    userAgentString = defaultUa.replace("; wv", "").replace("Version/4.0 ", "")
                    setSupportMultipleWindows(true)
                    javaScriptCanOpenWindowsAutomatically = true
                  }
                  android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                  webChromeClient = object : WebChromeClient() {
                    override fun onCloseWindow(window: WebView?) {
                      window?.destroy()
                      popupDialog.dismiss()
                    }
                  }
                  webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                      v: WebView?,
                      req: android.webkit.WebResourceRequest?
                    ): android.webkit.WebResourceResponse? {
                      val u = req?.url ?: return null
                      return assetLoader.shouldInterceptRequest(u)
                    }

                    override fun shouldOverrideUrlLoading(view: WebView?, request: android.webkit.WebResourceRequest?): Boolean {
                      return false
                    }
                  }
                }
                popupDialog.setContentView(newWebView)
                popupDialog.setOnDismissListener {
                  newWebView.destroy()
                }
                popupDialog.show()

                val transport = resultMsg?.obj as? WebView.WebViewTransport
                transport?.webView = newWebView
                resultMsg?.sendToTarget()
                return true
              }

              override fun onProgressChanged(view: WebView?, newProgress: Int) {
                pageProgress = newProgress / 100f
                isLoading = newProgress < 100
              }

              override fun onJsAlert(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
              ): Boolean {
                AlertDialog.Builder(context)
                  .setTitle("Buyero")
                  .setMessage(message)
                  .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                  .setCancelable(false)
                  .create()
                  .show()
                return true
              }

              override fun onJsConfirm(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
              ): Boolean {
                AlertDialog.Builder(context)
                  .setTitle("Buyero")
                  .setMessage(message)
                  .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                  .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                  .setCancelable(false)
                  .create()
                  .show()
                return true
              }
            }

            webViewClient = object : WebViewClient() {
              override fun shouldInterceptRequest(
                view: WebView?,
                request: android.webkit.WebResourceRequest?
              ): android.webkit.WebResourceResponse? {
                val u = request?.url ?: return null
                return assetLoader.shouldInterceptRequest(u)
              }

              override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                isLoading = false
              }
            }

            loadUrl(currentMode.assetUrl)
            webViewInstance = this
          }
        },
        update = { webView ->
          // Keep reference synced
          webViewInstance = webView
        }
      )
    }
  }

  // Info & Integration Sheet Dialog
  if (showInfoDialog) {
    Dialog(onDismissRequest = { showInfoDialog = false }) {
      Card(
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        modifier = Modifier
          .fillMaxWidth()
          .padding(16.dp)
      ) {
        Column(
          modifier = Modifier.padding(20.dp),
          verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
          Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
          ) {
            Box(
              modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(BuyeroNavy),
              contentAlignment = Alignment.Center
            ) {
              Icon(
                imageVector = Icons.Default.Info,
                contentDescription = null,
                tint = BuyeroOrange,
                modifier = Modifier.size(18.dp)
              )
            }
            Text(
              text = "Buyero Architecture",
              fontWeight = FontWeight.Bold,
              fontSize = 16.sp,
              color = BuyeroNavy
            )
          }

          Text(
            text = "Buyero is split into two distinct mobile-optimized environments connected via a real-time sync channel, Firebase, and Google Sheets webhook:",
            fontSize = 12.sp,
            color = Color(0xFF475569)
          )

          Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
              text = "• Buyero Client App: Storefront, category discovery, persistent cart, address form, simulated online/COD payments, workflow tracking timeline, and client-side jsPDF invoice generator.",
              fontSize = 11.sp,
              color = Color(0xFF1E293B)
            )
            Text(
              text = "• Buyero Admin Studio: Strict passcode access (default: admin123), dynamic profit analytics (Selling - Meesho Cost), order dispatch controls (Courier & AWB), live Google Sheets webhook trigger, and local notification broadcaster.",
              fontSize = 11.sp,
              color = Color(0xFF1E293B)
            )
            Text(
              text = "• Master Design System: Incorporates the custom 3D SVG Bag branding and 3-second splash screen layer with bounceIn & spin animation.",
              fontSize = 11.sp,
              color = Color(0xFF1E293B)
            )
          }

          Spacer(modifier = Modifier.height(4.dp))

          TextButton(
            onClick = { showInfoDialog = false },
            modifier = Modifier.align(Alignment.End)
          ) {
            Text(text = "Close", color = BuyeroOrange, fontWeight = FontWeight.Bold)
          }
        }
      }
    }
  }
}

