package com.ttylab.untail.tile

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class UntailTilePackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        application.registerActivityLifecycleCallbacks(ForegroundTracker)
      }
    })

  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(TileLaunchActivityListener())
}

class TileLaunchActivityListener : ReactActivityLifecycleListener {
  private var activity: WeakReference<Activity>? = null

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    this.activity = WeakReference(activity)
    TileLaunchStore.takeFrom(activity.intent)?.let(TileLaunchStore::put)
  }

  override fun onNewIntent(intent: Intent): Boolean {
    val launch = TileLaunchStore.takeFrom(intent)
    // Also clear the activity's original intent, which getIntent() keeps returning.
    activity?.get()?.intent?.let { TileLaunchStore.takeFrom(it) }
    launch?.let(TileLaunchStore::put)
    return false
  }
}
