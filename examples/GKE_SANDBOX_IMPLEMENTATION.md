# Network Control on GKE: Per-User Sandbox Implementation

## TL;DR

**YES! ✅** Docker/container-based network control works excellently on GKE. In fact, Kubernetes has **native features** specifically designed for this!

---

## Your Architecture

```
GKE Cluster
├── User 1 Sandbox (Pod/Namespace)
│   ├── Code Execution Container
│   └── NetworkPolicy (blocks egress)
├── User 2 Sandbox (Pod/Namespace)
│   ├── Code Execution Container
│   └── NetworkPolicy (blocks egress)
└── User N Sandbox...
```

---

## Approach 1: Kubernetes NetworkPolicies (RECOMMENDED)

### Why This is Better Than Docker networkMode='none':

✅ **Granular Control**: Allow specific traffic (DNS, internal services), block external
✅ **Native to K8s**: No Docker API needed
✅ **Per-Namespace**: Easy isolation per user
✅ **Declarative**: GitOps-friendly YAML configs
✅ **GKE Native**: Fully supported by Google

---

### Implementation: Block All External Traffic

```yaml
# user-sandbox-networkpolicy.yaml
# Apply this to each user's namespace

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: block-external-traffic
  namespace: user-sandbox-{{USER_ID}}  # One namespace per user
spec:
  # Apply to all pods in this namespace
  podSelector: {}

  policyTypes:
  - Egress

  egress:
  # Allow DNS (otherwise nothing works)
  - to:
    - namespaceSelector:
        matchLabels:
          name: kube-system
    ports:
    - protocol: UDP
      port: 53

  # Allow internal Kubernetes API (if needed)
  - to:
    - namespaceSelector: {}
    ports:
    - protocol: TCP
      port: 443

  # Block everything else (external internet)
  # By default, if no rule matches, traffic is denied
```

**What this does:**
- ✅ Allows DNS (required for any network operations)
- ✅ Allows internal K8s API calls
- ❌ Blocks ALL external internet (api.stripe.com, etc.)
- ❌ Blocks egress to external IPs

---

### Implementation: Allow Specific Domains Only

```yaml
# allowlist-networkpolicy.yaml
# Only allow specific approved APIs

apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allowlist-external-apis
  namespace: user-sandbox-{{USER_ID}}
spec:
  podSelector:
    matchLabels:
      app: code-executor

  policyTypes:
  - Egress

  egress:
  # Allow DNS
  - to:
    - namespaceSelector:
        matchLabels:
          name: kube-system
    ports:
    - protocol: UDP
      port: 53

  # Allow specific approved domains
  # Note: NetworkPolicy works with IPs, so you need to resolve domains to IPs
  # Or use a service mesh (Istio) for domain-based rules

  # Example: Allow Google APIs
  - to:
    - podSelector: {}
    ports:
    - protocol: TCP
      port: 443
  # This allows HTTPS but you'd need additional tooling to restrict to specific domains

  # For domain-based control, use Istio (see below)
```

---

## Approach 2: Istio Service Mesh (ADVANCED)

### Why Istio is Powerful:

✅ **Domain-based rules**: Block api.stripe.com by hostname
✅ **Request/response inspection**: See what's being called
✅ **Metrics**: Track all network calls per user
✅ **mTLS**: Secure internal communication

---

### Install Istio on GKE:

```bash
# Install Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-*
export PATH=$PWD/bin:$PATH

# Install on GKE cluster
istioctl install --set profile=default -y

# Enable sidecar injection for user sandboxes
kubectl label namespace user-sandbox-{{USER_ID}} istio-injection=enabled
```

---

### Block Specific Domains with Istio:

```yaml
# istio-block-stripe.yaml
# Block api.stripe.com for all users

apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: block-stripe
  namespace: user-sandbox-{{USER_ID}}
spec:
  # Apply to code execution pods
  selector:
    matchLabels:
      app: code-executor

  action: DENY

  rules:
  - to:
    - operation:
        hosts:
        - "api.stripe.com"
        - "*.stripe.com"
        ports:
        - "443"
        - "80"

---
# Allow only approved domains
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: allow-approved-apis
  namespace: user-sandbox-{{USER_ID}}
spec:
  selector:
    matchLabels:
      app: code-executor

  action: ALLOW

  rules:
  - to:
    - operation:
        hosts:
        - "api.github.com"
        - "api.yourapp.com"
        ports:
        - "443"
```

**What this does:**
- 🚫 Blocks Stripe API by domain name
- ✅ Allows only approved APIs
- 📊 Logs all attempts (viewable in Istio dashboards)

---

## Approach 3: GKE Workload Identity + VPC Service Controls

### GKE-Specific Security:

```yaml
# pod-with-workload-identity.yaml
apiVersion: v1
kind: Pod
metadata:
  name: code-executor-{{USER_ID}}
  namespace: user-sandbox-{{USER_ID}}
spec:
  serviceAccountName: code-executor-sa

  # Use GKE Workload Identity
  nodeSelector:
    iam.gke.io/gke-metadata-server-enabled: "true"

  containers:
  - name: code-executor
    image: gcr.io/{{PROJECT_ID}}/code-executor:latest

    # Security Context
    securityContext:
      runAsNonRoot: true
      runAsUser: 1000
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
        - ALL

    # Resource Limits
    resources:
      limits:
        memory: "512Mi"
        cpu: "500m"
      requests:
        memory: "256Mi"
        cpu: "250m"

    # Environment (no credentials!)
    env:
    - name: EXECUTION_MODE
      value: "sandbox"
```

---

## Complete User Sandbox Setup

### Architecture:

```
User Request → API Server → Create Sandbox
                                ↓
                    ┌────────────────────────┐
                    │ Namespace: user-xxx    │
                    ├────────────────────────┤
                    │ • Code Executor Pod    │
                    │ • NetworkPolicy        │
                    │ • ResourceQuota        │
                    │ • ServiceAccount       │
                    └────────────────────────┘
                                ↓
                    User Code Executes
                                ↓
                    Network Blocked by Policy
```

---

### Step 1: Create Namespace Per User

```yaml
# user-namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: user-sandbox-{{USER_ID}}
  labels:
    user-id: "{{USER_ID}}"
    sandbox: "true"
    istio-injection: enabled  # If using Istio

---
# Resource Quota (prevent resource abuse)
apiVersion: v1
kind: ResourceQuota
metadata:
  name: sandbox-quota
  namespace: user-sandbox-{{USER_ID}}
spec:
  hard:
    requests.cpu: "2"
    requests.memory: 2Gi
    limits.cpu: "4"
    limits.memory: 4Gi
    pods: "10"
```

---

### Step 2: Apply NetworkPolicy

```yaml
# networkpolicy.yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-external-egress
  namespace: user-sandbox-{{USER_ID}}
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  # Only allow DNS
  - to:
    - namespaceSelector:
        matchLabels:
          name: kube-system
    ports:
    - protocol: UDP
      port: 53
  # Everything else is blocked
```

---

### Step 3: Deploy Code Executor Pod

```yaml
# code-executor-pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: code-executor
  namespace: user-sandbox-{{USER_ID}}
  labels:
    app: code-executor
spec:
  restartPolicy: Never

  # Security
  securityContext:
    runAsNonRoot: true
    fsGroup: 1000

  containers:
  - name: executor
    image: node:20-alpine

    command:
    - node
    - /code/user-code.js

    securityContext:
      runAsUser: 1000
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop:
        - ALL

    resources:
      limits:
        memory: "512Mi"
        cpu: "500m"

    volumeMounts:
    - name: code
      mountPath: /code
      readOnly: true
    - name: tmp
      mountPath: /tmp

  volumes:
  - name: code
    configMap:
      name: user-code-{{EXECUTION_ID}}
  - name: tmp
    emptyDir: {}
```

---

## Testing: Verify Network Blocking

```yaml
# test-network-blocking.yaml
apiVersion: v1
kind: Pod
metadata:
  name: test-network
  namespace: user-sandbox-test
spec:
  containers:
  - name: test
    image: alpine
    command:
    - sh
    - -c
    - |
      echo "Testing network access..."

      # Should fail - external network
      echo "Test 1: curl to Stripe"
      curl -v https://api.stripe.com || echo "BLOCKED ✅"

      # Should fail - external network
      echo "Test 2: wget to AWS"
      wget https://s3.amazonaws.com || echo "BLOCKED ✅"

      # Should work - DNS
      echo "Test 3: DNS resolution"
      nslookup google.com || echo "DNS works ✅"

      # Should fail - cannot reach resolved IP
      echo "Test 4: Direct IP access"
      curl -v http://8.8.8.8 || echo "BLOCKED ✅"

      echo "All tests complete!"
```

```bash
# Apply test
kubectl apply -f test-network-blocking.yaml

# Check logs
kubectl logs -n user-sandbox-test test-network

# Expected output:
# Test 1: curl to Stripe
# BLOCKED ✅
# Test 2: wget to AWS
# BLOCKED ✅
```

---

## Node.js Code Executor Implementation

```javascript
// k8s-code-executor.js
// Drop-in replacement for Docker executor, uses K8s API

const k8s = require('@kubernetes/client-node');

class K8sCodeExecutor {
  constructor(config = {}) {
    this.kc = new k8s.KubeConfig();
    this.kc.loadFromDefault();

    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.namespace = config.namespace || 'default';
  }

  async executeCode(code, userId) {
    const executionId = `exec-${Date.now()}`;
    const namespace = `user-sandbox-${userId}`;

    try {
      // 1. Create namespace if not exists
      await this.ensureNamespace(namespace, userId);

      // 2. Apply NetworkPolicy
      await this.applyNetworkPolicy(namespace);

      // 3. Create ConfigMap with user code
      await this.createCodeConfigMap(namespace, executionId, code);

      // 4. Create Pod to execute code
      const pod = await this.createExecutorPod(namespace, executionId);

      // 5. Wait for completion
      const result = await this.waitForCompletion(namespace, pod.name);

      // 6. Get logs
      const logs = await this.getPodLogs(namespace, pod.name);

      return {
        success: result.exitCode === 0,
        output: logs,
        exitCode: result.exitCode
      };

    } finally {
      // Cleanup
      await this.cleanup(namespace, executionId);
    }
  }

  async ensureNamespace(namespace, userId) {
    try {
      await this.k8sApi.readNamespace(namespace);
    } catch (err) {
      if (err.statusCode === 404) {
        // Create namespace
        await this.k8sApi.createNamespace({
          metadata: {
            name: namespace,
            labels: {
              'user-id': userId,
              'sandbox': 'true'
            }
          }
        });
      }
    }
  }

  async applyNetworkPolicy(namespace) {
    const networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api);

    const policy = {
      metadata: {
        name: 'deny-external-egress',
        namespace
      },
      spec: {
        podSelector: {},
        policyTypes: ['Egress'],
        egress: [
          {
            // Allow DNS
            to: [{ namespaceSelector: { matchLabels: { name: 'kube-system' } } }],
            ports: [{ protocol: 'UDP', port: 53 }]
          }
        ]
      }
    };

    try {
      await networkingApi.createNamespacedNetworkPolicy(namespace, policy);
    } catch (err) {
      if (err.statusCode !== 409) throw err;  // Ignore if exists
    }
  }

  async createExecutorPod(namespace, executionId) {
    const pod = {
      metadata: {
        name: `executor-${executionId}`,
        namespace
      },
      spec: {
        restartPolicy: 'Never',
        containers: [
          {
            name: 'executor',
            image: 'node:20-alpine',
            command: ['node', '/code/user-code.js'],
            volumeMounts: [
              { name: 'code', mountPath: '/code', readOnly: true }
            ],
            securityContext: {
              runAsUser: 1000,
              allowPrivilegeEscalation: false,
              readOnlyRootFilesystem: true,
              capabilities: { drop: ['ALL'] }
            },
            resources: {
              limits: { memory: '512Mi', cpu: '500m' }
            }
          }
        ],
        volumes: [
          {
            name: 'code',
            configMap: { name: `code-${executionId}` }
          }
        ]
      }
    };

    const result = await this.k8sApi.createNamespacedPod(namespace, pod);
    return result.body;
  }

  async createCodeConfigMap(namespace, executionId, code) {
    const configMap = {
      metadata: {
        name: `code-${executionId}`,
        namespace
      },
      data: {
        'user-code.js': code
      }
    };

    await this.k8sApi.createNamespacedConfigMap(namespace, configMap);
  }

  async waitForCompletion(namespace, podName, timeout = 30000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const pod = await this.k8sApi.readNamespacedPodStatus(namespace, podName);
      const status = pod.body.status;

      if (status.phase === 'Succeeded' || status.phase === 'Failed') {
        const exitCode = status.containerStatuses[0].state.terminated?.exitCode || 0;
        return { exitCode };
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Execution timeout');
  }

  async getPodLogs(namespace, podName) {
    const logs = await this.k8sApi.readNamespacedPodLog(namespace, podName);
    return logs.body;
  }

  async cleanup(namespace, executionId) {
    // Delete pod
    await this.k8sApi.deleteNamespacedPod(
      `executor-${executionId}`,
      namespace
    ).catch(() => {});

    // Delete configmap
    await this.k8sApi.deleteNamespacedConfigMap(
      `code-${executionId}`,
      namespace
    ).catch(() => {});
  }
}

module.exports = K8sCodeExecutor;
```

---

## GKE-Specific Optimizations

### 1. Use GKE Autopilot (Serverless)

```yaml
# Works perfectly with Autopilot - no node management needed
# GKE automatically provisions resources per sandbox
```

### 2. Use Spot VMs for Cost Savings

```yaml
spec:
  nodeSelector:
    cloud.google.com/gke-spot: "true"
```

### 3. Enable Binary Authorization

```bash
# Only allow approved container images
gcloud container binauthz policy import policy.yaml
```

---

## Comparison: Codespaces vs GKE

| Feature | Codespaces | GKE |
|---------|-----------|-----|
| **Network Policies** | ⚠️ Limited | ✅ Native |
| **Per-User Isolation** | ⚠️ Shared host | ✅ Full namespace isolation |
| **Scalability** | ⚠️ Manual | ✅ Auto-scaling |
| **Cost** | 💰💰 Higher | 💰 Lower (spot VMs) |
| **Network Control** | ⚠️ Requires privileges | ✅ Built-in |
| **Production Ready** | ❌ Dev-focused | ✅ Yes |

**Verdict: GKE is better for production sandboxes!**

---

## Summary

### ✅ **YES - You Should Use This Approach on GKE!**

**Why GKE is Perfect:**
1. ✅ Native NetworkPolicy support
2. ✅ Per-user namespace isolation
3. ✅ Scales automatically
4. ✅ Production-grade security
5. ✅ Cost-effective with Spot VMs

**Recommended Stack:**
```
GKE Cluster
├── NetworkPolicies (block external egress)
├── Istio (optional, for domain-based control)
├── Per-user namespaces
└── Code execution pods (ephemeral)
```

**Implementation Priority:**
1. **Start with:** NetworkPolicies (easiest, native)
2. **Add if needed:** Istio (domain-based control)
3. **Monitor with:** GKE logging & metrics

This gives you **100% network isolation** just like Docker, but with Kubernetes-native tools! 🎯
