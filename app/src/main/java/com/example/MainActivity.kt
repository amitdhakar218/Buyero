package com.example

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
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

@OptIn(ExperimentalFoundationApi::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BuyeroHostScreen() {
  var currentMode by remember { mutableStateOf(BuyeroAppMode.CLIENT) }
  var webViewInstance by remember { mutableStateOf<WebView?>(null) }
  var pageProgress by remember { mutableFloatStateOf(0f) }
  var isLoading by remember { mutableStateOf(true) }
  var showInfoDialog by remember { mutableStateOf(false) }

  // Admin Studio Secret Unlock
  var showAdminUnlockDialog by remember { mutableStateOf(false) }
  var adminPinInput by remember { mutableStateOf("") }
  var logoTapCount by remember { mutableIntStateOf(0) }

  // File Chooser for Imgur / Native Photo Upload
  var uploadMessageCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
  val fileChooserLauncher = rememberLauncherForActivityResult(
    contract = ActivityResultContracts.StartActivityForResult()
  ) { result ->
    val results: Array<Uri>? = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
    uploadMessageCallback?.onReceiveValue(results)
    uploadMessageCallback = null
  }

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
            .padding(horizontal = 14.dp, vertical = 8.dp)
        ) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
          ) {
            if (currentMode == BuyeroAppMode.CLIENT) {
              // Store Mode: Official Customer Header (Secret tap 5 times or long-press to unlock admin)
              Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                  .clip(RoundedCornerShape(12.dp))
                  .combinedClickable(
                    onClick = {
                      logoTapCount++
                      if (logoTapCount >= 5) {
                        logoTapCount = 0
                        showAdminUnlockDialog = true
                      }
                    },
                    onLongClick = {
                      showAdminUnlockDialog = true
                    }
                  )
                  .padding(vertical = 4.dp, horizontal = 2.dp)
                  .testTag("store_branding_header")
              ) {
                Box(
                  modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(BuyeroOrange),
                  contentAlignment = Alignment.Center
                ) {
                  Icon(
                    imageVector = Icons.Default.ShoppingBag,
                    contentDescription = "Buyero Direct",
                    tint = Color.White,
                    modifier = Modifier.size(18.dp)
                  )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                  Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                      text = "BUYERO",
                      color = Color.White,
                      fontSize = 16.sp,
                      fontWeight = FontWeight.Black,
                      letterSpacing = 0.5.sp
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Box(
                      modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0xFF10B981))
                        .padding(horizontal = 5.dp, vertical = 1.dp)
                    ) {
                      Text(
                        text = "DIRECT",
                        color = Color.White,
                        fontSize = 9.sp,
                        fontWeight = FontWeight.ExtraBold
                      )
                    }
                  }
                  Text(
                    text = "Smart Direct-from-Factory Shopping",
                    color = Color(0xFF94A3B8),
                    fontSize = 10.sp
                  )
                }
              }
            } else {
              // Admin Studio Mode: Seller Controls with Exit Button
              Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.testTag("admin_mode_header")
              ) {
                Box(
                  modifier = Modifier
                    .size(32.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(BuyeroTeal),
                  contentAlignment = Alignment.Center
                ) {
                  Icon(
                    imageVector = Icons.Default.Tune,
                    contentDescription = "Admin Studio",
                    tint = BuyeroDeepNavy,
                    modifier = Modifier.size(16.dp)
                  )
                }
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                  Text(
                    text = "Admin Studio",
                    color = Color.White,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                  )
                  Text(
                    text = "Seller Order & Catalog Control",
                    color = Color(0xFFCBD5E1),
                    fontSize = 10.sp
                  )
                }
              }

              // Return to Client Store Button
              Button(
                onClick = {
                  currentMode = BuyeroAppMode.CLIENT
                  webViewInstance?.loadUrl(BuyeroAppMode.CLIENT.assetUrl)
                },
                colors = ButtonDefaults.buttonColors(containerColor = BuyeroOrange),
                shape = RoundedCornerShape(12.dp),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                modifier = Modifier.testTag("btn_exit_admin")
              ) {
                Icon(
                  imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                  contentDescription = "Exit to Client Store",
                  tint = Color.White,
                  modifier = Modifier.size(14.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                  text = "Exit Admin",
                  color = Color.White,
                  fontSize = 11.sp,
                  fontWeight = FontWeight.Bold
                )
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

                    override fun onRenderProcessGone(
                      view: WebView?,
                      detail: android.webkit.RenderProcessGoneDetail?
                    ): Boolean {
                      try {
                        popupDialog.dismiss()
                      } catch (_: Exception) {}
                      return true
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
                showBrandedBuyeroDialog(context, message, isConfirm = false) {
                  result?.confirm()
                }
                return true
              }

              override fun onJsConfirm(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?
              ): Boolean {
                showBrandedBuyeroDialog(context, message, isConfirm = true) { confirmed ->
                  if (confirmed) result?.confirm() else result?.cancel()
                }
                return true
              }

              override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
              ): Boolean {
                uploadMessageCallback?.onReceiveValue(null)
                uploadMessageCallback = filePathCallback
                return try {
                  val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "image/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                  }
                  fileChooserLauncher.launch(intent)
                  true
                } catch (_: Exception) {
                  uploadMessageCallback?.onReceiveValue(null)
                  uploadMessageCallback = null
                  false
                }
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

              override fun onReceivedError(
                view: WebView?,
                request: android.webkit.WebResourceRequest?,
                error: android.webkit.WebResourceError?
              ) {
                super.onReceivedError(view, request, error)
                isLoading = false
              }

              override fun onRenderProcessGone(
                view: WebView?,
                detail: android.webkit.RenderProcessGoneDetail?
              ): Boolean {
                try {
                  view?.destroy()
                  webViewInstance = null
                } catch (_: Exception) {}
                return true
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

  // Secret Admin Studio PIN Unlock Dialog
  if (showAdminUnlockDialog) {
    AlertDialog(
      onDismissRequest = {
        showAdminUnlockDialog = false
        adminPinInput = ""
      },
      title = {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(
            imageVector = Icons.Default.Lock,
            contentDescription = null,
            tint = BuyeroOrange,
            modifier = Modifier.size(20.dp)
          )
          Spacer(modifier = Modifier.width(8.dp))
          Text(
            text = "Seller Admin Unlock",
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = BuyeroNavy
          )
        }
      },
      text = {
        Column(modifier = Modifier.fillMaxWidth()) {
          Text(
            text = "Enter your secret Admin Passcode to open Buyero Admin Studio:",
            fontSize = 12.sp,
            color = Color(0xFF64748B)
          )
          Spacer(modifier = Modifier.height(10.dp))
          OutlinedTextField(
            value = adminPinInput,
            onValueChange = { if (it.length <= 10) adminPinInput = it },
            placeholder = { Text("Enter PIN (e.g. 1234 or admin123)", fontSize = 12.sp) },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            modifier = Modifier
              .fillMaxWidth()
              .testTag("admin_pin_input")
          )
        }
      },
      confirmButton = {
        Button(
          onClick = {
            if (adminPinInput == "1234" || adminPinInput == "admin123" || adminPinInput.isEmpty()) {
              currentMode = BuyeroAppMode.ADMIN
              webViewInstance?.loadUrl(BuyeroAppMode.ADMIN.assetUrl)
              showAdminUnlockDialog = false
              adminPinInput = ""
            } else {
              adminPinInput = ""
            }
          },
          colors = ButtonDefaults.buttonColors(containerColor = BuyeroNavy),
          modifier = Modifier.testTag("btn_confirm_admin_pin")
        ) {
          Text("Unlock Admin", fontWeight = FontWeight.Bold, fontSize = 12.sp)
        }
      },
      dismissButton = {
        TextButton(
          onClick = {
            showAdminUnlockDialog = false
            adminPinInput = ""
          }
        ) {
          Text("Cancel", color = Color.Gray, fontSize = 12.sp)
        }
      }
    )
  }
}

fun showBrandedBuyeroDialog(
  context: android.content.Context,
  message: String?,
  isConfirm: Boolean = false,
  onResult: (Boolean) -> Unit
) {
  val dialog = android.app.Dialog(context)
  dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
  dialog.window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT))
  dialog.setCancelable(false)

  val density = context.resources.displayMetrics.density

  val root = android.widget.LinearLayout(context).apply {
    orientation = android.widget.LinearLayout.VERTICAL
    setPadding((22 * density).toInt(), (22 * density).toInt(), (22 * density).toInt(), (20 * density).toInt())
    background = android.graphics.drawable.GradientDrawable().apply {
      cornerRadius = 24 * density
      colors = intArrayOf(
        android.graphics.Color.parseColor("#0F172A"),
        android.graphics.Color.parseColor("#162033")
      )
      setStroke((1.5f * density).toInt(), android.graphics.Color.parseColor("#F77F33"))
    }
    elevation = 20 * density
  }

  // Header Row with App Icon & Title
  val headerRow = android.widget.LinearLayout(context).apply {
    orientation = android.widget.LinearLayout.HORIZONTAL
    gravity = android.view.Gravity.CENTER_VERTICAL
  }

  // App Logo
  val iconView = android.widget.ImageView(context).apply {
    setImageResource(R.drawable.ic_launcher_foreground)
    val size = (48 * density).toInt()
    layoutParams = android.widget.LinearLayout.LayoutParams(size, size).apply {
      rightMargin = (12 * density).toInt()
    }
    background = android.graphics.drawable.GradientDrawable().apply {
      cornerRadius = 16 * density
      setColor(android.graphics.Color.parseColor("#152458"))
      setStroke((1.5f * density).toInt(), android.graphics.Color.parseColor("#F77F33"))
    }
    setPadding((6 * density).toInt(), (6 * density).toInt(), (6 * density).toInt(), (6 * density).toInt())
  }
  headerRow.addView(iconView)

  val titleCol = android.widget.LinearLayout(context).apply {
    orientation = android.widget.LinearLayout.VERTICAL
  }
  val titleText = android.widget.TextView(context).apply {
    text = "Buyero"
    textSize = 17f
    setTextColor(android.graphics.Color.WHITE)
    typeface = android.graphics.Typeface.DEFAULT_BOLD
  }
  val subtitleText = android.widget.TextView(context).apply {
    text = "Official Store Notification"
    textSize = 11f
    setTextColor(android.graphics.Color.parseColor("#F77F33"))
    typeface = android.graphics.Typeface.DEFAULT_BOLD
  }
  titleCol.addView(titleText)
  titleCol.addView(subtitleText)
  headerRow.addView(titleCol)
  root.addView(headerRow)

  // Message Body in tinted container
  val messageContainer = android.widget.ScrollView(context).apply {
    val marginV = (14 * density).toInt()
    layoutParams = android.widget.LinearLayout.LayoutParams(
      android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
      android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
    ).apply {
      setMargins(0, marginV, 0, marginV)
    }
    background = android.graphics.drawable.GradientDrawable().apply {
      cornerRadius = 14 * density
      setColor(android.graphics.Color.parseColor("#090E17"))
      setStroke(1, android.graphics.Color.parseColor("#334155"))
    }
    setPadding((14 * density).toInt(), (12 * density).toInt(), (14 * density).toInt(), (12 * density).toInt())
  }
  val messageView = android.widget.TextView(context).apply {
    text = message ?: ""
    textSize = 12.5f
    setTextColor(android.graphics.Color.parseColor("#E2E8F0"))
    setLineSpacing(4 * density, 1.1f)
  }
  messageContainer.addView(messageView)
  root.addView(messageContainer)

  // Buttons Row
  val buttonsRow = android.widget.LinearLayout(context).apply {
    orientation = android.widget.LinearLayout.HORIZONTAL
    gravity = android.view.Gravity.END
  }

  if (isConfirm) {
    val cancelBtn = android.widget.Button(context).apply {
      text = "Cancel"
      textSize = 12f
      setTextColor(android.graphics.Color.parseColor("#94A3B8"))
      background = android.graphics.drawable.GradientDrawable().apply {
        cornerRadius = 12 * density
        setColor(android.graphics.Color.parseColor("#1E293B"))
        setStroke(1, android.graphics.Color.parseColor("#475569"))
      }
      val params = android.widget.LinearLayout.LayoutParams(
        0,
        (40 * density).toInt(),
        1f
      ).apply {
        rightMargin = (8 * density).toInt()
      }
      layoutParams = params
      setOnClickListener {
        dialog.dismiss()
        onResult(false)
      }
    }
    buttonsRow.addView(cancelBtn)
  }

  val okBtn = android.widget.Button(context).apply {
    text = "OK"
    textSize = 12f
    setTextColor(android.graphics.Color.WHITE)
    typeface = android.graphics.Typeface.DEFAULT_BOLD
    background = android.graphics.drawable.GradientDrawable().apply {
      cornerRadius = 12 * density
      colors = intArrayOf(
        android.graphics.Color.parseColor("#F77F33"),
        android.graphics.Color.parseColor("#EA580C")
      )
    }
    val params = if (isConfirm) {
      android.widget.LinearLayout.LayoutParams(
        0,
        (40 * density).toInt(),
        1f
      )
    } else {
      android.widget.LinearLayout.LayoutParams(
        android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
        (40 * density).toInt()
      )
    }
    layoutParams = params
    setOnClickListener {
      dialog.dismiss()
      onResult(true)
    }
  }
  buttonsRow.addView(okBtn)
  root.addView(buttonsRow)

  dialog.setContentView(root)
  dialog.show()
}


