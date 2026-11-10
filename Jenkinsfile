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
          def deploy = '''#!/usr/bin/env bash
            set -eu
            cd "${WORKSPACE}"
            chmod +x deploy/*.sh deploy/certs/*.sh 2>/dev/null || true
            bash deploy/jenkins-ci.sh
          '''
          def withLinkedIn = { body ->
            def linkedInStarted = false
            try {
              withCredentials([
                string(credentialsId: 'meetcon-linkedin-client-id', variable: 'MEETCON_LINKEDIN_CLIENT_ID'),
                string(credentialsId: 'meetcon-linkedin-client-secret', variable: 'MEETCON_LINKEDIN_CLIENT_SECRET'),
              ]) {
                linkedInStarted = true
                body()
              }
            } catch (err) {
              def text = err.toString()
              def missingLinkedIn = !linkedInStarted && (text.contains('Could not find credentials') || text.contains('CredentialsNotFound') || text.contains('meetcon-linkedin-client-'))
              if (missingLinkedIn) {
                echo 'LinkedIn credentials are not in Jenkins. Sign-in stays off until secret text credentials meetcon-linkedin-client-id and meetcon-linkedin-client-secret exist.'
                body()
              } else {
                throw err
              }
            }
          }
          if (ciOnly) {
            withEnv(['MEETCON_CI_ONLY=1']) {
              sh deploy
            }
          } else {
            def started = false
            try {
              withCredentials([file(credentialsId: credId, variable: 'MEETCON_ENV_FILE')]) {
                started = true
                withLinkedIn { sh deploy }
              }
            } catch (err) {
              def text = err.toString()
              def missingCreds = !started && (text.contains('Could not find credentials') || text.contains('CredentialsNotFound') || text.contains(credId))
              if (missingCreds) {
                echo "No secret file '${credId}'. This build will create the production env and TLS certificate on the VM, then install MeetPlus."
                withLinkedIn { sh deploy }
              } else {
                throw err
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
