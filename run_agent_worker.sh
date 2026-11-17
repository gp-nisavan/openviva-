#!/bin/bash
export LD_LIBRARY_PATH=/home/savan/openviva/agent_env/lib/python3.10/site-packages/nvidia/cublas/lib:/home/savan/openviva/agent_env/lib/python3.10/site-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH
exec /home/savan/openviva/agent_env/bin/python -u /home/savan/openviva/agent_worker.py
