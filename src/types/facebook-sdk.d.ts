export {};

declare global {
  interface FacebookLoginOptions {
    config_id: string;
    response_type: 'code';
    override_default_response_type: true;
    extras?: {
      featureType?: string;
      sessionInfoVersion?: string;
    };
  }

  interface FacebookAuthResponse {
    code?: string;
  }

  interface FacebookLoginResponse {
    authResponse?: FacebookAuthResponse | null;
  }

  interface FacebookSDK {
    init(options: {
      appId: string;
      cookie: boolean;
      xfbml: boolean;
      version: string;
    }): void;
    login(
      callback: (response: FacebookLoginResponse) => void,
      options: FacebookLoginOptions
    ): void;
  }

  interface Window {
    FB?: FacebookSDK;
    fbAsyncInit?: () => void;
  }
}
