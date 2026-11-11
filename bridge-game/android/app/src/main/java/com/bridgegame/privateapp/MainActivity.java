package com.bridgegame.privateapp;
import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.View;
public class MainActivity extends Activity {
  private WebView web;
  private PermissionRequest pending;
  @Override public void onCreate(Bundle b){super.onCreate(b);
    web=new WebView(this);setContentView(web);
    WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setMediaPlaybackRequiresUserGesture(false);
    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient(){
      @Override public void onPermissionRequest(PermissionRequest request){
        runOnUiThread(()->{pending=request;askPermissions();});
      }
    });
    askPermissions();
    web.loadUrl("https://bridge-game-2kde.onrender.com/");
  }
  private void askPermissions(){
    if(Build.VERSION.SDK_INT>=23 && (checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)){
      requestPermissions(new String[]{Manifest.permission.CAMERA,Manifest.permission.RECORD_AUDIO},17);return;
    }
    if(pending!=null){PermissionRequest p=pending;pending=null;
      String[] asked=p.getResources();java.util.ArrayList<String> allowed=new java.util.ArrayList<>();
      for(String a:asked)if(a.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)||a.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE))allowed.add(a);
      p.grant(allowed.toArray(new String[0]));
    }
  }
  @Override public void onRequestPermissionsResult(int code,String[] perms,int[] results){super.onRequestPermissionsResult(code,perms,results);if(code==17){if(results.length>0){boolean ok=true;for(int i:results)if(i!=PackageManager.PERMISSION_GRANTED)ok=false;if(ok)askPermissions();else if(pending!=null){pending.deny();pending=null;}}}}
  @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
  @Override public void onDestroy(){web.destroy();super.onDestroy();}
}