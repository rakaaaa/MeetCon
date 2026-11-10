// MeetPlus on the built-in Jenkins node.
// Build Now does a full Docker install on port 30098: env, TLS, images, migration, health, smoke.
// Optional Secret file credential meetcon-production-env replaces the generated env.
// Optional job env: MEETCON_PUBLIC_HOST, MEETCON_SMOKE_FULL=1, MEETCON_ISOLATED_SIM=1

pipeline {
  agent { label 'built-in' }

  options {
    timestamps()
    disableConcurrentBuilds(abortPrevious: true)
    timeout(time: 120, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    CI = 'true'
    DOCKER_BUILDKIT = '1'
    COMPOSE_DOCKER_CLI_BUILD = '1'
  }

  stages {
    stage('Checkout') {
      steps {
        retry(2) {
          deleteDir()
          checkout scm
        }
        sh 'git log -1 --oneline'
      }
    }

    stage('Deploy') {
      steps {
        script {
          def ciOnly = (env.MEETCON_CI_ONLY ?: '').trim().toLowerCase() in ['1', 'true', 'yes', 'on']
          def credId = (env.MEETCON_CREDS_ENV ?: 'meetcon-production-env').trim()
          def deploy = '''
            set -eu
            cd "${WORKSPACE}"
            chmod +x deploy/*.sh deploy/certs/*.sh 2>/dev/null || true
            umask 077
            if [ -n "${MEETCON_LINKEDIN_CLIENT_ID:-}" ]; then
              printf %s "$MEETCON_LINKEDIN_CLIENT_ID" > deploy/.linkedin-id
              echo "LinkedIn client id reached the shell. Length ${#MEETCON_LINKEDIN_CLIENT_ID}."
            elif [ -n "${MEETCON_LINKEDIN_ID_FILE:-}" ] && [ -f "$MEETCON_LINKEDIN_ID_FILE" ]; then
              cp "$MEETCON_LINKEDIN_ID_FILE" deploy/.linkedin-id
              echo "LinkedIn client id was read from a Jenkins secret file."
            else
              echo "WARN: LinkedIn client id did not reach the shell." >&2
            fi
            if [ -n "${MEETCON_LINKEDIN_CLIENT_SECRET:-}" ]; then
              printf %s "$MEETCON_LINKEDIN_CLIENT_SECRET" > deploy/.linkedin-secret
              echo "LinkedIn client secret reached the shell. Length ${#MEETCON_LINKEDIN_CLIENT_SECRET}."
            elif [ -n "${MEETCON_LINKEDIN_SECRET_FILE:-}" ] && [ -f "$MEETCON_LINKEDIN_SECRET_FILE" ]; then
              cp "$MEETCON_LINKEDIN_SECRET_FILE" deploy/.linkedin-secret
              echo "LinkedIn client secret was read from a Jenkins secret file."
            else
              echo "WARN: LinkedIn client secret did not reach the shell." >&2
            fi
            bash deploy/jenkins-ci.sh
          '''
          def credentialMiss = { err ->
            def text = err.toString()
            return text.contains('Could not find credentials') || text.contains('CredentialsNotFound')
          }
          if (ciOnly) {
            withEnv(['MEETCON_CI_ONLY=1']) {
              sh deploy
            }
          } else {
            try {
              withCredentials([
                file(credentialsId: credId, variable: 'MEETCON_ENV_FILE'),
                string(credentialsId: 'meetcon-linkedin-client-id', variable: 'MEETCON_LINKEDIN_CLIENT_ID'),
                string(credentialsId: 'meetcon-linkedin-client-secret', variable: 'MEETCON_LINKEDIN_CLIENT_SECRET'),
              ]) {
                sh deploy
              }
            } catch (err) {
              if (!credentialMiss(err)) {
                throw err
              }
              echo 'Secret text binding failed. Trying the same ids as Secret files.'
              try {
                withCredentials([
                  file(credentialsId: credId, variable: 'MEETCON_ENV_FILE'),
                  file(credentialsId: 'meetcon-linkedin-client-id', variable: 'MEETCON_LINKEDIN_ID_FILE'),
                  file(credentialsId: 'meetcon-linkedin-client-secret', variable: 'MEETCON_LINKEDIN_SECRET_FILE'),
                ]) {
                  sh deploy
                }
              } catch (err2) {
                if (credentialMiss(err2) && !err2.toString().contains('meetcon-linkedin')) {
                  echo "No secret file '${credId}'. This build will create the production env on the VM, then install MeetPlus."
                  withCredentials([
                    string(credentialsId: 'meetcon-linkedin-client-id', variable: 'MEETCON_LINKEDIN_CLIENT_ID'),
                    string(credentialsId: 'meetcon-linkedin-client-secret', variable: 'MEETCON_LINKEDIN_CLIENT_SECRET'),
                  ]) {
                    sh deploy
                  }
                } else {
                  throw err2
                }
              }
            }
          }
        }
      }
    }
  }

  post {
    success {
      echo 'MeetPlus is up. Open the WEB_ORIGIN printed in the Deploy log (default port 30098).'
    }
    failure {
      echo 'Check: jenkins user is in the docker group. LinkedIn sign-in needs the two Jenkins secret text credentials.'
    }
  }
}
