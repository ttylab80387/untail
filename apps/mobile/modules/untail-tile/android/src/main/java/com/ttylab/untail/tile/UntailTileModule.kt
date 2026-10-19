package com.ttylab.untail.tile

import android.app.StatusBarManager
import android.content.ComponentName
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.ViewTreeObserver
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class UntailTileModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("UntailTile")
    Events("onTileLaunch")

    // The event only says "a request is waiting"; JS takes it with consumeTileLaunch(), exactly once.
    OnCreate { TileLaunchStore.listener = { sendEvent("onTileLaunch", emptyMap<String, Any>()) } }
    OnDestroy { TileLaunchStore.listener = null }

    Function("consumeTileLaunch") {
      TileLaunchStore.consume()?.let { mapOf("wasInForeground" to it.wasInForeground) }
    }

    AsyncFunction("waitForWindowFocus") { timeoutMs: Int, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      if (activity.hasWindowFocus()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val decor = activity.window.decorView
      var done = false
      lateinit var listener: ViewTreeObserver.OnWindowFocusChangeListener
      lateinit var timeout: Runnable
      val finish = { ok: Boolean ->
        if (!done) {
          done = true
          main.removeCallbacks(timeout)
          // An observer taken before the window attached is dead by now; always remove from the current one.
          decor.viewTreeObserver.let { if (it.isAlive) it.removeOnWindowFocusChangeListener(listener) }
          promise.resolve(ok)
        }
      }
      listener = ViewTreeObserver.OnWindowFocusChangeListener { focused -> if (focused) finish(true) }
      timeout = Runnable { finish(activity.hasWindowFocus()) }
      decor.viewTreeObserver.addOnWindowFocusChangeListener(listener)
      main.postDelayed(timeout, timeoutMs.toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("moveTaskToBack") {
      appContext.currentActivity?.moveTaskToBack(true) ?: false
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("requestAddTile") { promise: Promise ->
      val activity = appContext.currentActivity
      if (Build.VERSION.SDK_INT < 33 || activity == null) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      val manager = activity.getSystemService(StatusBarManager::class.java)
      if (manager == null) {
        promise.resolve("unsupported")
        return@AsyncFunction
      }
      var settled = false
      val decor = activity.window.decorView
      lateinit var focusListener: ViewTreeObserver.OnWindowFocusChangeListener
      lateinit var timeout: Runnable
      val settle = { result: String ->
        if (!settled) {
          settled = true
          main.removeCallbacks(timeout)
          decor.viewTreeObserver.let { if (it.isAlive) it.removeOnWindowFocusChangeListener(focusListener) }
          promise.resolve(result)
        }
      }
      // Closing the system dialog with Back or a tap outside never calls back, so regaining focus
      // (after a grace period for a late callback) or a 30 s timeout ends the wait.
      var lostFocus = false
      focusListener = ViewTreeObserver.OnWindowFocusChangeListener { focused ->
        if (!focused) lostFocus = true else if (lostFocus) main.postDelayed({ settle("dismissed") }, 1000)
      }
      timeout = Runnable { settle("dismissed") }
      decor.viewTreeObserver.addOnWindowFocusChangeListener(focusListener)
      main.postDelayed(timeout, 30_000)
      try {
        manager.requestAddTileService(
          ComponentName(activity, CleanLinkTileService::class.java),
          activity.getString(R.string.untail_tile_label),
          Icon.createWithResource(activity, R.drawable.ic_untail_tile),
          activity.mainExecutor,
        ) { code ->
          settle(
            when (code) {
              StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "added"
              StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "already"
              StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_NOT_ADDED -> "dismissed"
              else -> "unsupported"
            },
          )
        }
      } catch (e: Exception) {
        settle("unsupported")
      }
    }.runOnQueue(Queues.MAIN)
  }
}
